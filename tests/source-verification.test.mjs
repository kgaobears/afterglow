import test from "node:test";
import assert from "node:assert/strict";
import { hasExactSupport, inspectSourceMemories, reconcileSourceMemories } from "../app/source-verification.ts";
import { acceptedAuditCandidates, fallbackAtomize, retainMissingPeople } from "../app/atomization.ts";

const note = "Jason started a new job. Sarah's daughter is applying to college. Michael is training for a marathon.";
const jason = { name: "Jason", detail: "He has a new job", quote: "Jason started a new job." };
const sarah = { name: "Sarah", detail: "Her daughter is applying to college", quote: "Sarah's daughter is applying to college." };

test("a failed second pass retains all source-backed candidates for review", () => {
  const result = reconcileSourceMemories(note, [jason, sarah], []);
  assert.deepEqual(result.map(m => [m.name, m.verification]), [["Jason", "review"], ["Sarah", "review"]]);
});

test("only candidates independently confirmed with the same person and note are ready", () => {
  const result = reconcileSourceMemories(note, [jason, sarah], [jason]);
  assert.deepEqual(result.map(m => m.verification), ["verified", "review"]);
});

test("an audit changing the person or factual content cannot confer confirmation", () => {
  const result = reconcileSourceMemories(note, [jason], [
    { ...jason, name: "Sarah" },
    { ...jason, detail: "He started a company instead" },
  ]);
  assert.equal(result[0].verification, "review");
});

test("a paraphrased atomic fact may be verified without literal source text", () => {
  const fake = { name: "Jason", detail: "Started a company", quote: "Jason started a company." };
  const short = { name: "Jason", detail: "Has a new job", quote: "new job" };
  assert.deepEqual(reconcileSourceMemories(note, [fake, short], [short]).map(m => m.verification), ["review", "verified"]);
});

test("Kyle's paraphrased short note can be verified without verbatim evidence", () => {
  const raw = "At church I heard Kyle has a brother two years older, living in San Francisco. Kyle went to see him this weekend.";
  const kyle = {
    name: "Kyle",
    detail: "has a brother, two years older than him, living in SF. He visited him this past weekend.",
    quote: "He visited his brother last weekend.",
  };
  assert.deepEqual(reconcileSourceMemories(raw, [kyle], [kyle]), [{ ...kyle, verification: "verified" }]);
  assert.equal(inspectSourceMemories(raw, [kyle], [kyle])[0].sourceMatch, false);
});

test("missing evidence is fine after verification; empty details still cannot be saved", () => {
  const noQuote = { name: "Sarah", detail: "Her daughter is applying to college", quote: "" };
  const noDetail = { name: "Michael", detail: "", quote: "Michael is training for a marathon." };
  assert.equal(reconcileSourceMemories(note, [noQuote], [noQuote])[0].verification, "verified");
  assert.equal(inspectSourceMemories(note, [noDetail], [noDetail])[0].status, "excluded");
});

test("a detail copied exactly from the note can provide evidence without a quote", () => {
  const memory = { name: "Jason", detail: "Jason started a new job.", quote: "" };
  assert.equal(hasExactSupport(note, memory), true);
  assert.equal(reconcileSourceMemories(note, [memory], [memory])[0].verification, "verified");
});

test("minor case and spacing differences still match actual source text", () => {
  const cited = { ...jason, quote: "JASON  started a new job." };
  assert.equal(reconcileSourceMemories(note, [cited], [cited])[0].verification, "verified");
});

test("duplicate candidates are displayed only once", () => {
  assert.equal(reconcileSourceMemories(note, [jason, { ...jason }], [jason]).length, 1);
});

test("diagnostics explain verification, rejection and missing citations", () => {
  const fake = { ...jason, detail: "Started a company", quote: "Jason became CEO." };
  const decisions = inspectSourceMemories(note, [jason, sarah, fake, jason], [jason]);
  assert.deepEqual(decisions.map(d => d.status), ["verified", "review", "review", "excluded"]);
  assert.match(decisions[2].reason, /couldn't confidently confirm/);
  assert.match(decisions[3].reason, /Duplicate/);
});

test("fallback atomizer preserves the Kyle visit as its own short note", () => {
  const coarse = { name: "Kyle", detail: "has a brother, two years older than him, living in SF. He visited him this past weekend.", quote: "He visited his brother last weekend." };
  assert.deepEqual(fallbackAtomize([coarse]).map(m => m.detail), [
    "has a brother, two years older than him, living in SF.",
    "He visited his brother last weekend.",
  ]);
});

test("atomizer retains entire people it omitted", () => {
  const one = { name: "Kyle", detail: "Visited his brother last weekend.", quote: "" };
  const another = { name: "Sarah", detail: "Started a new job.", quote: "" };
  assert.deepEqual(retainMissingPeople([one], [one, another]).map(m => m.name), ["Kyle", "Sarah"]);
});

test("audit accepts stable zero-based indices without rewriting notes", () => {
  const candidates = [jason, sarah];
  assert.deepEqual(acceptedAuditCandidates({ accepted: [1, 1, -1, 99, 0.5, "0"] }, candidates), [sarah, jason]);
  assert.deepEqual(acceptedAuditCandidates({ accepted: [0, 1] }, candidates), candidates);
  assert.deepEqual(acceptedAuditCandidates({ memories: [jason] }, candidates), []);
});
