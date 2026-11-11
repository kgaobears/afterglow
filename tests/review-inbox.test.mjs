import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewSections, countReviewItems } from "../app/review-inbox-model.ts";

const note = (id, gatheringId, name, status, contactId = null) => ({ id, gatheringId, name, status, contactId, detail: `${id} detail`, reason: "", createdAt: 1 });
const sessions = [
  { id: "new", title: "Church", groupName: "Small Group", date: "2026-11-10", createdAt: 20 },
  { id: "old", title: "Dinner", groupName: "Friends", date: "2026-11-07", createdAt: 10 },
];

test("the global inbox keeps people next to their facts within each gathering", () => {
  const items = [note("k1", "new", "Kyle", "needs_review"), note("k2", "new", "Kyle", "ready"), note("s1", "new", "Sarah", "ready", "sarah-id"), note("m", "old", "Michael", "needs_review")];
  const sections = buildReviewSections(sessions, items, [{ id: "sarah-id", name: "Sarah" }]);
  assert.deepEqual(sections.map(section => section.session.id), ["new", "old"]);
  assert.deepEqual(sections[0].queue.map(entry => entry.kind === "person" ? `person:${entry.group.name}` : `fact:${entry.item.id}`), ["fact:k1", "fact:k2", "person:Kyle", "fact:s1"]);
  assert.equal(countReviewItems(items), 6);
});

test("reviewing a fact removes only its decision while keeping unresolved identity rows", () => {
  const items = [note("a", "new", "Kyle", "approved_pending_person"), note("b", "new", "Kyle", "confirmed", "kyle-id"), note("c", "old", "Sarah", "rejected")];
  const sections = buildReviewSections(sessions, items, []);
  assert.deepEqual(sections.map(section => section.session.id), ["new"]);
  assert.deepEqual(sections[0].queue.map(entry => entry.kind), ["person"]);
  assert.equal(countReviewItems(items), 1);
});

test("the review badge counts separate identity decisions across gatherings", () => {
  const items = [note("k1", "new", "Kyle", "needs_review"), note("k2", "old", "Kyle", "needs_review")];
  assert.equal(countReviewItems(items), 4);
  assert.equal(buildReviewSections(sessions, items, []).reduce((sum, section) => sum + section.count, 0), 4);
});

test("a fully reviewed gathering disappears without deleting its saved history", () => {
  const sections = buildReviewSections(sessions, [note("a", "new", "Kyle", "confirmed", "kyle-id")], []);
  assert.deepEqual(sections, []);
});
