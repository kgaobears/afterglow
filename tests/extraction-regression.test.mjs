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

test("three standalone Kyle facts provide complete information coverage", () => {
  assert.deepEqual(scoreExtraction(kyle, allThree), {
    covered: 3, total: 3, correctlyTyped: 3, missing: [], wrongType: [], matchingMemoryIndices: [0, 1, 2],
  });
});

test("one compound note cannot masquerade as three independent facts", () => {
  const combined = [{ name: "Kyle", detail: "Has a brother two years older living in SF, whom he visited last weekend.", factType: "timeline" }];
  const result = scoreExtraction(kyle, combined);
  assert.equal(result.covered, 1);
  assert.equal(result.missing.length, 2);
  assert.equal(result.correctlyTyped, 0);
});

test("coverage catches missing residence even when other details survive", () => {
  const result = scoreExtraction(kyle, [allThree[0], allThree[2]]);
  assert.equal(result.covered, 2);
  assert.deepEqual(result.missing, ["Brother lives in San Francisco"]);
});

test("classification is scored separately from preserving facts", () => {
  const result = scoreExtraction(kyle, [{ ...allThree[0], factType: "timeline" }, ...allThree.slice(1)]);
  assert.equal(result.covered, 3);
  assert.equal(result.correctlyTyped, 2);
  assert.deepEqual(result.wrongType, ["Brother's age difference"]);
});

test("coverage pass adds recovered details without overwriting original candidates", () => {
  const first = [allThree[2]];
  const merged = mergeCoverageCandidates(first, [allThree[0], allThree[1], allThree[2]]);
  assert.deepEqual(merged, [allThree[2], allThree[0], allThree[1]]);
  assert.equal(scoreExtraction(kyle, merged).covered, 3);
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
