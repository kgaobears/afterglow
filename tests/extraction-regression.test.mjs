import test from "node:test";
import assert from "node:assert/strict";
import { EXTRACTION_FIXTURES, scoreExtraction } from "../app/extraction-regression.ts";
import { consolidateAtomicMemories, mergeCoverageCandidates, splitIndependentEvents } from "../app/atomization.ts";

const kyle = EXTRACTION_FIXTURES.find(fixture => fixture.id === "kyle_brother");
const allThree = [
  { name: "Kyle", detail: "Has a brother two years older than him.", factType: "profile" },
  { name: "Kyle", detail: "His brother lives in San Francisco.", factType: "profile" },
  { name: "Kyle", detail: "Visited his brother last weekend.", factType: "timeline" },
];

test("Kyle passes with a brother profile and a separate visit event", () => {
  assert.deepEqual(scoreExtraction(kyle, allThree), {
    covered: 2, total: 2, correctlyTyped: 2, missing: [], wrongType: [], matchingMemoryIndices: [0, 2], redundantCount: 0, forbiddenMatches: [], wrongReview: [],
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

test("Kyle's five overlapping suggestions become three standalone facts", () => {
  const note = kyle.note;
  const proposed = [
    { name: "Kyle", detail: "Has a brother who is two years older than him and lives in SF", factType: "profile" },
    { name: "Kyle's brother", detail: "Lives in SF", factType: "profile" },
    { name: "Kyle", detail: "Visited his brother last weekend", factType: "timeline" },
    { name: "Kyle", detail: "Has a brother who is two years older than him", factType: "profile" },
    { name: "Kyle", detail: "Their brother lives in SF", factType: "profile" },
  ].map(item => ({ ...item, quote: "" }));
  const cleaned = consolidateAtomicMemories(proposed, note);
  assert.equal(scoreExtraction(kyle, proposed).redundantCount, 2);
  assert.equal(cleaned.length, 3);
  assert.equal(scoreExtraction(kyle, cleaned).redundantCount, 0);
  assert.equal(scoreExtraction(kyle, cleaned).covered, 2);
  assert.deepEqual(cleaned.map(item => item.factType).sort(), ["profile", "profile", "timeline"].sort());
  assert.ok(cleaned.every(item => item.name === "Kyle"));
});

test("a relative's age difference remains a profile even when Qwen calls it a timeline", () => {
  const memories = consolidateAtomicMemories([
    { name: "Kyle", detail: "Kyle's brother is two years older than him.", quote: "", factType: "timeline" },
    { name: "Kyle", detail: "Kyle visited his brother last weekend.", quote: "", factType: "timeline" },
  ], kyle.note);
  assert.equal(memories[0].factType, "profile");
  assert.equal(scoreExtraction(kyle, memories).correctlyTyped, 2);
});

test("unsupported reversed visitor is excluded when source names the opposite visitor", () => {
  const memories = consolidateAtomicMemories([
    { name: "Kyle's brother", detail: "Kyle's brother visited Kyle last weekend.", factType: "timeline", quote: "" },
    { name: "Kyle", detail: "Kyle visited his brother last weekend.", factType: "timeline", quote: "" },
  ], kyle.note);
  assert.deepEqual(memories.map(item => item.name), ["Kyle"]);
});

test("consolidation retains compound detail when independent facts do not cover it", () => {
  const facts = [
    { name: "Kyle", detail: "Has a brother who is two years older than him and lives in SF", factType: "profile", quote: "" },
    { name: "Kyle", detail: "Has a brother who is two years older than him", factType: "profile", quote: "" },
  ];
  assert.equal(consolidateAtomicMemories(facts, kyle.note).length, 2);
});

test("all fixtures have unique IDs and expectations", () => {
  assert.equal(EXTRACTION_FIXTURES.length, 10);
  assert.equal(new Set(EXTRACTION_FIXTURES.map(item => item.id)).size, EXTRACTION_FIXTURES.length);
  for (const fixture of EXTRACTION_FIXTURES) {
    assert.ok(fixture.note && fixture.date && fixture.expected.length);
    assert.equal(new Set(fixture.expected.map(item => item.label)).size, fixture.expected.length);
  }
});

test("forbidden claims fail even if required memories are present", () => {
  const fixture = EXTRACTION_FIXTURES.find(item => item.id === "self_correction");
  const result = scoreExtraction(fixture, [
    { name: "Michael", detail: "Moving to Boston next month", factType: "timeline" },
    { name: "Michael", detail: "His wife found a job in Boston", factType: "timeline" },
    { name: "Michael", detail: "Moving to New York next month", factType: "timeline" },
  ]);
  assert.equal(result.covered, 2);
  assert.deepEqual(result.forbiddenMatches, ["Discarded New York destination"]);
});

test("a correctly directed kinship description is not mistaken for a reversed relationship", () => {
  const fixture = EXTRACTION_FIXTURES.find(item => item.id === "named_relatives");
  const correct = scoreExtraction(fixture, [
    { name: "Francis", detail: "Kyle's older brother who lives in San Francisco.", factType: "profile" },
    { name: "Emily", detail: "Kyle's younger sister who just moved to Seattle.", factType: "timeline" },
  ]);
  assert.deepEqual(correct.forbiddenMatches, []);
  const reversed = scoreExtraction(fixture, [
    { name: "Francis", detail: "Has an older brother named Kyle who lives in San Francisco.", factType: "profile" },
    { name: "Emily", detail: "Has a younger sister named Kyle.", factType: "profile" },
  ]);
  assert.deepEqual(reversed.forbiddenMatches, [
    "Francis has older brother Kyle (reversed)", "Emily has younger sister Kyle (reversed)",
  ]);
});

test("genuinely ambiguous attribution does not fail an otherwise useful conversation", () => {
  const fixture = EXTRACTION_FIXTURES.find(item => item.id === "ambiguous_pronoun");
  const result = scoreExtraction(fixture, [
    { name: "Michael", detail: "Moving to Texas", factType: "timeline" },
    { name: "Unattributed", detail: "Someone got promoted", factType: "timeline", verification: "verified" },
    { name: "Jason", detail: "Was promoted", factType: "timeline" },
  ]);
  assert.equal(result.covered, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.wrongReview, []);
  assert.deepEqual(result.forbiddenMatches, []);
});

test("optional historical facts do not affect required coverage", () => {
  const fixture = EXTRACTION_FIXTURES.find(item => item.id === "temporary_states");
  const notes = [
    { name: "Sarah", detail: "Recently joined Apple", factType: "timeline" },
    { name: "Sarah", detail: "Works at Apple", factType: "profile" },
    { name: "Sarah", detail: "Temporarily staying with parents while looking for an apartment in Cupertino", factType: "timeline" },
  ];
  const result = scoreExtraction(fixture, notes);
  assert.equal(result.covered, result.total);
  assert.deepEqual(result.forbiddenMatches, []);
});

test("one meaningful profile memory can bundle a relative's residence and duration", () => {
  const fixture = EXTRACTION_FIXTURES.find(item => item.id === "semantic_duplicates");
  const bundled = [{ name: "Kyle", detail: "Kyle's brother Francis lives in San Francisco and has been there for three years.", factType: "profile" }];
  const result = scoreExtraction(fixture, bundled);
  assert.equal(result.covered, 1);
  assert.equal(result.total, 1);
  assert.equal(result.correctlyTyped, 1);
  assert.deepEqual(result.missing, []);
  assert.equal(result.redundantCount, 0);
  assert.equal(scoreExtraction(fixture, [{ name: "Francis", detail: bundled[0].detail, factType: "profile" }]).covered, 0);
  assert.equal(scoreExtraction(fixture, [{ name: "Kyle", detail: "Has a brother named Francis", factType: "profile" }]).covered, 0);
});

test("explicit correction removes the superseded destination but retains the replacement", () => {
  const fixture = EXTRACTION_FIXTURES.find(item => item.id === "self_correction");
  const memories = consolidateAtomicMemories([
    { name: "Michael", detail: "Moving to New York next month", factType: "timeline", quote: "" },
    { name: "Michael", detail: "Moving to New York instead", factType: "profile", quote: "" },
    { name: "Michael", detail: "Moving to Boston next month", factType: "timeline", quote: "" },
  ], fixture.note);
  assert.deepEqual(memories.map(item => item.detail), ["Moving to Boston next month"]);
  assert.deepEqual(scoreExtraction(fixture, memories).forbiddenMatches, []);
});

test("distinct comma-separated milestones split while related residence context stays bundled", () => {
  const source = EXTRACTION_FIXTURES.find(item => item.id === "multiple_dates");
  const parts = splitIndependentEvents({ name: "Emily", detail: "Emily graduated from Berkeley in 2022, started working at Nvidia in 2023, and got engaged last weekend.", factType: "timeline", quote: "" });
  assert.deepEqual(parts.map(x => x.detail), ["Emily graduated from Berkeley in 2022", "started working at Nvidia in 2023", "got engaged last weekend."]);
  assert.equal(scoreExtraction(source, parts).covered, 3);
  const bundled = splitIndependentEvents({ name: "Kyle", detail: "Kyle's brother Francis lives in San Francisco and has been there for three years.", factType: "profile", quote: "" });
  assert.equal(bundled.length, 1);
});
