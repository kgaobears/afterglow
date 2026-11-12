import test from "node:test";
import assert from "node:assert/strict";
import { attachNamedRelativeUpdates, explicitRelationshipAnchors, preserveRelationshipDirections } from "../app/relationship-anchors.ts";
import { EXTRACTION_FIXTURES } from "../app/extraction-regression.ts";
import { consolidateAtomicMemories } from "../app/atomization.ts";

const note = EXTRACTION_FIXTURES.find(item => item.id === "named_relatives").note;
const memory = (name, detail) => ({ name, detail, factType: "profile", quote: "" });

test("source establishes directional named family relationships", () => {
  assert.deepEqual(explicitRelationshipAnchors(note), [
    { owner: "Kyle", relation: "older brother", relative: "Francis" },
    { owner: "Kyle", relation: "younger sister", relative: "Emily" },
  ]);
});

test("later model passes cannot reverse named siblings", () => {
  const candidates = [
    memory("Kyle", "Has an older brother named Francis who lives in SF"),
    memory("Francis", "Has an older brother named Kyle who lives in SF"),
    memory("Emily", "Has a younger sister named Kyle who just moved to Seattle"),
    memory("Emily", "Moved to Seattle"),
  ];
  assert.deepEqual(preserveRelationshipDirections(candidates, note), [candidates[0], candidates[3]]);
});

test("unknown or independently stated relationships are not guessed or erased", () => {
  const candidate = memory("Francis", "Has a younger sister named Emily");
  assert.deepEqual(preserveRelationshipDirections([candidate], note), [candidate]);
  const reciprocal = "Kyle has an older brother named Francis. Francis has an older brother named Kyle.";
  assert.deepEqual(preserveRelationshipDirections([memory("Francis", "Has an older brother named Kyle")], reciprocal).length, 1);
});

test("named relatives' profile and timeline updates can be stored under Kyle", () => {
  const updates = attachNamedRelativeUpdates([
    memory("Francis", "Kyle's older brother who lives in San Francisco"),
    { ...memory("Emily", "Moved to Seattle"), factType: "timeline" },
  ], note);
  assert.deepEqual(updates.map(item => item.name), ["Kyle", "Kyle"]);
  assert.match(updates[0].detail, /older brother Francis lives in San Francisco/);
  assert.match(updates[1].detail, /younger sister Emily moved to Seattle/);
});

test("one profile and two distinct events survive cleanup without invented contacts", () => {
  const proposed = [
    { ...memory("Kyle", "Visited Francis, his older brother, last weekend"), factType: "timeline" },
    memory("Francis", "Kyle's older brother who lives in San Francisco"),
    { ...memory("Emily", "Kyle's younger sister who just moved to Seattle"), factType: "timeline" },
    { ...memory("Has a younger sister who just moved to Seattle", "Kyle's younger sister Emily just moved to Seattle"), factType: "timeline" },
  ];
  const result = consolidateAtomicMemories(proposed, note);
  assert.equal(result.length, 3);
  assert.ok(result.every(item => item.name === "Kyle"));
  assert.equal(result.filter(item => item.factType === "profile").length, 1);
  assert.equal(result.filter(item => item.factType === "timeline").length, 2);
});
