import test from "node:test";
import assert from "node:assert/strict";
import { applyAuditedFactTypes, inferFactType, partitionContactMemories } from "../app/fact-type.ts";
import { fallbackAtomize } from "../app/atomization.ts";

test("a family relationship is a profile fact, but a recent visit is a timeline event", () => {
  assert.equal(inferFactType("Kyle has a brother two years older than him who lives in SF."), "profile");
  assert.equal(inferFactType("Kyle visited his brother last weekend."), "timeline");
});

test("a current occupation is a profile fact, but starting a new job is an event", () => {
  assert.equal(inferFactType("Works at a hospital as a dentist."), "profile");
  assert.equal(inferFactType("Started a new job last week.", "profile"), "timeline");
  assert.equal(inferFactType("Her daughter is applying to college."), "timeline");
  assert.equal(inferFactType("Is training for a marathon."), "timeline");
});

test("the atomization fallback classifies each extracted fact independently", () => {
  const initial = [{ name: "Kyle", detail: "Has a brother two years older living in SF. He visited him last weekend.", quote: "He visited his brother last weekend.", factType: "profile" }];
  const items = fallbackAtomize(initial);
  assert.deepEqual(items.map(item => [item.detail, item.factType]), [
    ["Has a brother two years older living in SF.", "profile"],
    ["He visited his brother last weekend.", "timeline"],
  ]);
});

test("the verifier may classify existing candidates by index without inventing any", () => {
  const candidates = [
    { detail: "Has a brother living in SF.", factType: "timeline" },
    { detail: "Visited him last weekend.", factType: "profile" },
    { detail: "Enjoys playing violin.", factType: "profile" },
  ];
  const result = applyAuditedFactTypes({ profile: [0, 2, 900], timeline: [1] }, candidates);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(item => item.factType), ["profile", "timeline", "profile"]);
  assert.deepEqual(applyAuditedFactTypes({ profile: [0], timeline: [0] }, candidates), candidates);
});

test("the contact page partitions records while leaving legacy records on the timeline", () => {
  const items = [{ id: "a", factType: "profile" }, { id: "b", factType: "timeline" }, { id: "legacy" }];
  const result = partitionContactMemories(items);
  assert.deepEqual(result.profile.map(item => item.id), ["a"]);
  assert.deepEqual(result.timeline.map(item => item.id), ["b", "legacy"]);
});
