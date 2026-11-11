import test from "node:test";
import assert from "node:assert/strict";
import { EXTRACTION_FIXTURES, scoreExtraction } from "../app/extraction-regression.ts";
import { mergeCoverageCandidates } from "../app/atomization.ts";

const kyle = EXTRACTION_FIXTURES.find(fixture => fixture.id === "kyle_brother");
const allThree = [
  { name: "Kyle", detail: "Has a brother two years older than him.", factType: "profile" },
  { name: "Kyle", detail: "His brother lives in San Francisco.", factType: "profile" },
  { name: "Kyle", detail: "Visited his brother last weekend.", factType: "timeline" },
];

test("Kyle passes with a brother profile and a separate visit event", () => {
  assert.deepEqual(scoreExtraction(kyle, allThree), {
    covered: 2, total: 2, correctlyTyped: 2, missing: [], wrongType: [], matchingMemoryIndices: [0, 2],
  });
});

test("one compound note cannot masquerade as a profile fact and a separate visit", () => {
  const combined = [{ name: "Kyle", detail: "Has a brother two years older living in SF, whom he visited last weekend.", factType: "timeline" }];
  const result = scoreExtraction(kyle, combined);
  assert.equal(result.covered, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.correctlyTyped, 0);
});

test("brother's residence is optional when relationship and visit are present", () => {
  const result = scoreExtraction(kyle, [allThree[0], allThree[2]]);
  assert.equal(result.covered, 2);
  assert.equal(result.total, 2);
  assert.deepEqual(result.missing, []);
});

test("classification is scored separately from preserving facts", () => {
  const result = scoreExtraction(kyle, [{ ...allThree[0], factType: "timeline" }, ...allThree.slice(1)]);
  assert.equal(result.covered, 2);
  assert.equal(result.correctlyTyped, 1);
  assert.deepEqual(result.wrongType, ["Has a brother two years older"]);
});

test("a reversed visit does not count as Kyle visiting his brother", () => {
  const result = scoreExtraction(kyle, [allThree[0], { name: "Kyle", detail: "Kyle's brother visited Kyle last weekend", factType: "timeline" }]);
  assert.equal(result.covered, 1);
  assert.deepEqual(result.missing, ["Kyle visited his brother last weekend"]);
});

test("coverage pass adds recovered details without overwriting original candidates", () => {
  const first = [allThree[2]];
  const merged = mergeCoverageCandidates(first, [allThree[0], allThree[1], allThree[2]]);
  assert.deepEqual(merged, [allThree[2], allThree[0], allThree[1]]);
  assert.equal(scoreExtraction(kyle, merged).covered, 2);
});

test("coverage rejects duplicate whitespace and punctuation variants", () => {
  const merged = mergeCoverageCandidates([allThree[0]], [{ ...allThree[0], detail: "  Has a brother, two years older than him! " }]);
  assert.equal(merged.length, 1);
});

test("all fixtures have unique IDs and expectations", () => {
  assert.equal(new Set(EXTRACTION_FIXTURES.map(item => item.id)).size, EXTRACTION_FIXTURES.length);
  for (const fixture of EXTRACTION_FIXTURES) {
    assert.ok(fixture.note && fixture.date && fixture.expected.length);
    assert.equal(new Set(fixture.expected.map(item => item.label)).size, fixture.expected.length);
  }
});
