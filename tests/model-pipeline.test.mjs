import test from "node:test";
import assert from "node:assert/strict";
import { extractLocally } from "../app/local-inference.ts";
import { EXTRACTION_FIXTURES, scoreExtraction } from "../app/extraction-regression.ts";

const fixture = id => EXTRACTION_FIXTURES.find(item => item.id === id);
const memory = (name, detail, factType) => ({ name, detail, quote: "", factType });
const kyleAtoms = [
  memory("Kyle", "Has a brother two years older than him.", "profile"),
  memory("Kyle", "His brother lives in San Francisco.", "profile"),
  memory("Kyle", "Visited his brother last weekend.", "timeline"),
];
const churchAtoms = [
  memory("Jason", "Started a new job at church.", "timeline"),
  memory("Sarah", "Her daughter is applying to college.", "timeline"),
  memory("Michael", "Training for a marathon.", "timeline"),
];
const reply = memories => JSON.stringify({ memories });

function scriptedModel(responses) {
  const calls = [];
  const complete = async (messages, maxTokens) => {
    calls.push({ messages, maxTokens });
    if (!responses.length) throw new Error("Unexpected model call");
    return responses.shift();
  };
  return { complete, calls };
}

async function runCase(caseFixture, model, options = {}) {
  const diagnostics = {};
  const progress = [];
  const memories = await extractLocally(caseFixture.note, [], "quality", entry => progress.push(entry),
    update => Object.assign(diagnostics, update),
    { complete: model.complete, captureRequests: true, gatheringDate: caseFixture.date,
      enableCoveragePass: false, enableTemporalPass: false, ...options });
  return { memories, diagnostics, progress, score: scoreExtraction(caseFixture, memories) };
}

test("same production pipeline works without WebGPU and preserves three independent Kyle facts", async () => {
  const model = scriptedModel([
    reply([memory("Kyle", "Has a brother two years older than him who lives in SF. Kyle visited his brother last weekend.", "profile")]),
    reply(kyleAtoms),
    JSON.stringify({ accepted: [0, 1, 2] }),
  ]);
  const result = await runCase(fixture("kyle_brother"), model);
  assert.equal(result.score.covered, 2);
  assert.equal(result.score.correctlyTyped, 2);
  assert.equal(result.memories.length, 3);
  assert.equal(result.diagnostics.firstParsed, 1);
  assert.equal(result.diagnostics.atomizeParsed, 3);
  assert.equal(result.diagnostics.verifiedCount, 3);
  assert.equal(model.calls.length, 3);
  assert.match(model.calls[0].messages[1].content, /Kyle visited his brother last weekend/);
});

test("malformed initial JSON is recoverable from the original note, without silently dropping speakers", async () => {
  const model = scriptedModel([
    '{"memories":[{"name":"Jason","detail":"new job"}BROKEN',
    reply(churchAtoms),
    JSON.stringify({ accepted: [0, 1, 2] }),
  ]);
  const result = await runCase(fixture("church_group"), model);
  assert.equal(result.score.covered, 3);
  assert.equal(result.score.correctlyTyped, 3);
  assert.match(result.diagnostics.firstError, /JSON/);
  assert.match(model.calls[1].messages[1].content, /At church, Jason said/);
  assert.equal(result.memories.length, 3);
});

test("optional coverage pass can restore independently missing profile facts", async () => {
  const model = scriptedModel([
    reply([kyleAtoms[2]]),
    reply([kyleAtoms[2]]),
    reply(kyleAtoms.slice(0, 2)),
    JSON.stringify({ accepted: [0, 1, 2] }),
  ]);
  const result = await runCase(fixture("kyle_brother"), model, { enableCoveragePass: true });
  assert.equal(result.score.covered, 2);
  assert.equal(result.diagnostics.coverageAdded, 2);
  assert.equal(model.calls.length, 4);
  assert.match(model.calls[2].messages[1].content, /ORIGINAL NOTE/);
  assert.equal(result.memories[0].factType, "timeline");
});

test("recovers Qwen's array-shaped coverage and unnamed-relative attribution", async () => {
  const model = scriptedModel([
    reply([kyleAtoms[2]]),
    reply([kyleAtoms[2]]),
    JSON.stringify([
      { name: "Kyle's brother", detail: "Has a brother two years older than him" },
      { name: "Kyle's brother", detail: "Lives in SF" },
    ]),
    JSON.stringify({ accepted: [0, 1, 2] }),
  ]);
  const result = await runCase(fixture("kyle_brother"), model, { enableCoveragePass: true });
  assert.equal(result.score.covered, 2);
  assert.equal(result.score.correctlyTyped, 2);
  assert.equal(result.diagnostics.coverageAdded, 2);
  assert.equal(result.diagnostics.coverageError, undefined);
  assert.ok(result.memories.every(item => item.name === "Kyle"));
  assert.match(model.calls[1].messages[1].content, /ORIGINAL GATHERING NOTE/);
});

test("atomizer cannot erase a correct first-pass visit by reversing the visitor", async () => {
  const model = scriptedModel([
    reply([
      kyleAtoms[2],
      memory("Kyle's brother", "Kyle's brother lives in SF.", "profile"),
    ]),
    reply([
      memory("Kyle", "Kyle's brother lives in SF.", "profile"),
      memory("Kyle's brother", "Kyle's brother visited Kyle last weekend.", "timeline"),
    ]),
    JSON.stringify([{ name: "Kyle", detail: "Kyle has a brother who is two years older than him." }]),
    JSON.stringify({ accepted: [0, 1, 2, 3, 4] }),
  ]);
  const result = await runCase(fixture("kyle_brother"), model, { enableCoveragePass: true });
  assert.equal(result.score.covered, 2);
  assert.equal(result.score.correctlyTyped, 2);
  assert.ok(result.memories.some(item => item.name === "Kyle" && /visited his brother/i.test(item.detail)));
});

test("a model which omits facts still fails the real regression scorer", async () => {
  const model = scriptedModel([
    reply([kyleAtoms[2]]),
    reply([kyleAtoms[2]]),
    JSON.stringify({ accepted: [0] }),
  ]);
  const result = await runCase(fixture("kyle_brother"), model);
  assert.equal(result.score.covered, 1);
  assert.deepEqual(result.score.missing, ["Has a brother two years older"]);
});

test("directional relationship anchors survive model passes and remove invented reversals", async () => {
  const named = fixture("named_relatives");
  const model = scriptedModel([
    reply([memory("Kyle", "Has an older brother named Francis", "profile")]),
    reply([
      memory("Kyle", "Has an older brother named Francis", "profile"),
      memory("Francis", "Has an older brother named Kyle", "profile"),
      memory("Emily", "Has a younger sister named Kyle", "profile"),
      memory("Emily", "Moved to Seattle", "timeline"),
    ]),
    JSON.stringify({ accepted: [0, 1, 2, 3] }),
  ]);
  const result = await runCase(named, model);
  assert.equal(result.memories.length, 2);
  assert.ok(result.memories.some(item => item.name === "Kyle" && /Francis/.test(item.detail)));
  assert.ok(result.memories.some(item => item.name === "Emily" && /Seattle/.test(item.detail)));
  assert.match(model.calls[1].messages[1].content, /direction is fixed/);
});
