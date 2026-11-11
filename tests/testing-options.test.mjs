import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TESTING_OPTIONS, migratePreviousTestingOptions, parseTestingOptions } from "../app/testing-options.ts";
import { protectCapturedItem, suppressReprocessedFact } from "../app/reprocess-policy.ts";

test("testing defaults preserve rejections and keep existing features visible", () => {
  assert.deepEqual(parseTestingOptions(null), DEFAULT_TESTING_OPTIONS);
  assert.equal(DEFAULT_TESTING_OPTIONS.reconsiderRejected, false);
  assert.equal(DEFAULT_TESTING_OPTIONS.runTemporalPass, false);
  assert.equal(DEFAULT_TESTING_OPTIONS.runCoveragePass, false);
});

test("unknown or invalid testing settings cannot override known defaults", () => {
  assert.deepEqual(parseTestingOptions('{"showDiagnostics":false,"reconsiderRejected":"yes","unknown":true}'), {
    ...DEFAULT_TESTING_OPTIONS, showDiagnostics: false,
  });
  assert.deepEqual(parseTestingOptions("not JSON"), DEFAULT_TESTING_OPTIONS);
});

test("previous experimental settings migrate without re-enabling unstable passes", () => {
  assert.deepEqual(migratePreviousTestingOptions('{"reconsiderRejected":true,"runCoveragePass":true,"runTemporalPass":true,"showDiagnostics":false}'), {
    ...DEFAULT_TESTING_OPTIONS, reconsiderRejected: true, showDiagnostics: false,
  });
});

test("reprocess test mode can resurface rejected suggestions while preserving decisions", () => {
  assert.equal(protectCapturedItem("rejected"), true);
  assert.equal(protectCapturedItem("confirmed"), true);
  assert.equal(protectCapturedItem("approved_pending_person"), true);
  assert.equal(protectCapturedItem("needs_review"), false);
  assert.equal(suppressReprocessedFact("rejected", false), true);
  assert.equal(suppressReprocessedFact("rejected", true), false);
  assert.equal(suppressReprocessedFact("confirmed", true), true);
});
