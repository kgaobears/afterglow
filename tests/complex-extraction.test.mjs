import test from "node:test";
import assert from "node:assert/strict";
import { COMPLEX_EXTRACTION_FIXTURES } from "../app/complex-extraction-fixtures.ts";
import { scoreExtractionWeighted, scoreExtraction } from "../app/extraction-regression.ts";

const fixture = id => COMPLEX_EXTRACTION_FIXTURES.find(item => item.id === id);

test("eight distinct complex fixtures preserve the original ten-case baseline", () => {
  assert.equal(COMPLEX_EXTRACTION_FIXTURES.length, 8);
  assert.equal(new Set(COMPLEX_EXTRACTION_FIXTURES.map(item => item.id)).size, 8);
  assert.ok(COMPLEX_EXTRACTION_FIXTURES.every(item => item.expected.length >= 2));
});

test("perfectly recovered complex milestones score 100", () => {
  const notes = [
    { name: "Sarah", detail: "Injured ankle in March", factType: "timeline", verification: "verified" },
    { name: "Sarah", detail: "Stopped running for two months", factType: "timeline", verification: "verified" },
    { name: "Sarah", detail: "Started physical therapy in May", factType: "timeline", verification: "verified" },
    { name: "Sarah", detail: "Completed first 5K since recovery", factType: "timeline", verification: "verified" },
  ];
  const result = scoreExtractionWeighted(fixture("complex_causal_milestones"), notes);
  assert.equal(result.matchedFacts, 4);
  assert.equal(result.total, 100);
});

test("missing expected fact costs more than unsupported review candidate", () => {
  const f = fixture("complex_ideation");
  const complete = [
    { name: "Jason", detail: "Thinking about opening a restaurant", factType: "timeline", verification: "verified" },
    { name: "Jason", detail: "Shift from Japanese food toward Korean barbecue", factType: "timeline", verification: "verified" },
  ];
  const perfect = scoreExtractionWeighted(f, complete);
  assert.equal(perfect.total, 100);
  const omitted = scoreExtractionWeighted(f, complete.slice(0, 1));
  const extraReview = scoreExtractionWeighted(f, [...complete, { name: "Jason", detail: "Opened a restaurant", factType: "timeline", verification: "review" }]);
  assert.ok(perfect.total - omitted.total > perfect.total - extraReview.total);
  assert.equal(extraReview.deductions.unsupportedReview, 5);
});

test("unsupported verified fact is penalized more heavily than review-only", () => {
  const f = fixture("complex_ideation");
  const unsupported = { name: "Jason", detail: "Opened a restaurant", factType: "timeline" };
  const valid = [
    { name: "Jason", detail: "Thinking about opening a restaurant", factType: "timeline" },
    { name: "Jason", detail: "Shift from Japanese food toward Korean barbecue", factType: "timeline" },
  ];
  const review = scoreExtractionWeighted(f, [...valid, { ...unsupported, verification: "review" }]);
  const verified = scoreExtractionWeighted(f, [...valid, { ...unsupported, verification: "verified" }]);
  assert.equal(review.deductions.unsupportedReview, 5);
  assert.equal(verified.deductions.unsupportedVerified, 15);
  assert.equal(review.total - verified.total, 10);
});

test("incorrect attribution still counts semantic recall but loses attribution credit", () => {
  const f = fixture("complex_ideation");
  const wrong = [{ name: "Michael", detail: "Thinking about opening a restaurant", factType: "timeline" }];
  const s = scoreExtractionWeighted(f, wrong);
  assert.equal(s.components.recall, 20);
  assert.equal(s.components.attribution, 0);
});

test("verification is scored, not silently treated as success", () => {
  const f = { ...fixture("complex_ideation"), expected: [
    { label: "Verified job", person: "Jason", signals: ["job"], factType: "timeline", verifiedRequired: true },
  ] };
  const row = { name: "Jason", detail: "Found a job", factType: "timeline", verification: "review" };
  assert.equal(scoreExtractionWeighted(f, [row]).components.verification, 0);
  assert.equal(scoreExtractionWeighted(f, [{ ...row, verification: "verified" }]).components.verification, 15);
});

test("baseline strict scorer still requires separate rows for independent events", () => {
  const f = fixture("complex_causal_milestones");
  const compound = [{ name: "Sarah", detail: "Injured ankle in March, stopped running for two months, started physical therapy in May, and completed first 5K since recovering", factType: "timeline" }];
  assert.equal(scoreExtraction(f, compound).covered, 1);
  assert.equal(scoreExtractionWeighted(f, compound).matchedFacts, 4);
});
