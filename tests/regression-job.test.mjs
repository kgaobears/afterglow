import test from "node:test";
import assert from "node:assert/strict";
import { fixturesForRun, parseRegressionJobOptions, regressionSummary, scoreReportedRun } from "../app/regression-job.ts";
import { acquireLocalModel, currentLocalModelActivity, releaseLocalModel } from "../app/local-model-activity.ts";

test("only source-controlled fictional fixtures can be queued", () => {
  assert.deepEqual(fixturesForRun(null).map(item => item.id), ["kyle_brother", "church_group"]);
  assert.deepEqual(parseRegressionJobOptions({}), {
    modelChoice: "quality", fixtureId: null, coverageEnabled: false, temporalEnabled: false,
  });
  assert.throws(() => parseRegressionJobOptions({ fixtureId: "../../contacts" }), /Unknown regression fixture/);
  assert.throws(() => parseRegressionJobOptions({ modelChoice: "remote-hosted" }), /Unknown offline model/);
});

test("server ignores a browser's claimed score and detects missing independent facts", () => {
  const options = parseRegressionJobOptions({ fixtureId: "kyle_brother" });
  const results = scoreReportedRun(options, [{ id: "kyle_brother", score: { covered: 3, total: 3 }, memories: [
    { name: "Kyle", detail: "Visited brother last weekend.", factType: "timeline" },
  ] }]);
  assert.equal(results[0].score.covered, 1);
  assert.equal(regressionSummary(results).passed, false);
  assert.deepEqual(results[0].score.missing, ["Brother's age difference", "Brother lives in San Francisco"]);
});

test("server rejects a partial fixture report and doesn't count a compound fact twice", () => {
  assert.throws(() => scoreReportedRun(parseRegressionJobOptions({}), []), /Some regression cases are missing/);
  const result = scoreReportedRun(parseRegressionJobOptions({ fixtureId: "kyle_brother" }), [{
    id: "kyle_brother", memories: [
      { name: "Kyle", detail: "Has a brother two years older in San Francisco who he visited last weekend.", factType: "timeline" },
    ],
  }]);
  assert.equal(result[0].score.covered, 1);
  assert.equal(regressionSummary(result).passed, false);
});

test("one tab cannot use the shared WebGPU model for two jobs simultaneously", () => {
  assert.equal(acquireLocalModel("gathering"), true);
  assert.equal(acquireLocalModel("remote-regression"), false);
  releaseLocalModel("remote-regression");
  assert.equal(currentLocalModelActivity(), "gathering");
  releaseLocalModel("gathering");
  assert.equal(acquireLocalModel("remote-regression"), true);
  releaseLocalModel("remote-regression");
});
