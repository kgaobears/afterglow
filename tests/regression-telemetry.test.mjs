import test from "node:test";
import assert from "node:assert/strict";
import { regressionFailed, regressionPassLogs } from "../app/regression-telemetry.ts";

const fixtureResult = {
  id: "kyle_brother", title: "Kyle example", sourceNote: "Kyle visited his older brother in SF.", gatheringDate: "2026-11-11",
  model: "quality", coverageEnabled: false, temporalEnabled: false, durationMs: 2200, progress: [],
  memories: [{ name: "Kyle", detail: "Visited brother last weekend", factType: "timeline" }],
  score: { covered: 1, total: 3, correctlyTyped: 1, missing: ["Brother's age difference", "Brother lives in SF"], wrongType: [], matchingMemoryIndices: [0], redundantCount: 0, forbiddenMatches: [], wrongReview: [] },
  diagnostics: { firstRequest: [{ role: "system", content: "Return JSON" }, { role: "user", content: "Kyle visited his older brother in SF." }], firstRaw: "INVALID JSON", firstError: "Unexpected token", atomizeRaw: '{"memories":[]}', atomizeParsed: 0, auditRaw: '{"accepted":[0]}', auditParsed: 1 },
};

test("failed regression retains full raw LLM responses, errors, and optional-pass states", () => {
  assert.equal(regressionFailed(fixtureResult), true);
  const logs = regressionPassLogs(fixtureResult);
  assert.deepEqual(logs.map(x => x.status), ["error", "completed", "skipped", "completed", "skipped"]);
  assert.equal(logs[0].raw, "INVALID JSON");
  assert.equal(logs[0].request[0][0].content, "Return JSON");
  assert.equal(logs[0].error, "Unexpected token");
  assert.equal(logs[3].raw, '{"accepted":[0]}');
});

test("a case that throws before verification still exposes earlier pass logs", () => {
  const result = { ...fixtureResult, coverageEnabled: true, temporalEnabled: true, error: "Bad output", diagnostics: { firstRaw: "first", atomizeRaw: "second" } };
  const logs = regressionPassLogs(result);
  assert.equal(regressionFailed(result), true);
  assert.deepEqual(logs.map(x => x.status), ["completed", "completed", "not-reached", "not-reached", "not-reached"]);
});

test("fully covered and correctly typed cases are not marked failed", () => {
  const result = { ...fixtureResult, score: { ...fixtureResult.score, covered: 3, correctlyTyped: 3, missing: [] } };
  assert.equal(regressionFailed(result), false);
});
