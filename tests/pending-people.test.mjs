import test from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedReviewQueue, eligiblePendingSpeakers, groupPotentialPeople, needsSpeakerSelection, partitionNotesForReview } from "../app/pending-people.ts";

const note = (id, name, status = "ready", contactId = null) => ({ id, name, detail: `Memory ${id}`, status, contactId });

test("three notes about one unfamiliar person become one person review item", () => {
  const groups = groupPotentialPeople([note("a", "Kyle"), note("b", "kyle", "needs_review"), note("c", "Kyle")], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Kyle");
  assert.deepEqual(groups[0].items.map(item => item.id), ["a", "b", "c"]);
  assert.equal(groups[0].existingContactId, null);
});

test("unattributed facts get a person row while already linked facts do not", () => {
  const groups = groupPotentialPeople([note("a", "Unattributed", "needs_review"), note("b", "Sarah", "ready", "sarah-id"), note("c", "Sarah", "confirmed", null)], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, "unknown:a");
  assert.equal(groups[0].name, "Unknown person");
  assert.deepEqual(groups[0].items.map(item => item.id), ["a"]);
});

test("an existing contact can be offered when a past unlinked note is revisited", () => {
  const groups = groupPotentialPeople([note("a", "Kyle")], [{ id: "k1", name: "Kyle Gao" }]);
  assert.equal(groups[0].existingContactId, "k1");
});

test("two existing Jasons get one ambiguous person decision, never a silent match", () => {
  const groups = groupPotentialPeople([note("a", "Jason")], [{ id: "j1", name: "Jason Lee" }, { id: "j2", name: "Jason Kim" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matchCount, 2);
  assert.equal(groups[0].existingContactId, null);
  assert.deepEqual(groups[0].items.map(item => item.id), ["a"]);
});

test("unattributed facts stay separate rather than merging unrelated speakers", () => {
  const groups = groupPotentialPeople([note("a", "Unattributed"), note("b", "Unattributed")], []);
  assert.deepEqual(groups.map(group => group.key), ["unknown:a", "unknown:b"]);
  const queue = buildUnifiedReviewQueue(partitionNotesForReview([note("a", "Unattributed"), note("b", "Unattributed")]).needsReview, groups);
  assert.deepEqual(queue.map(entry => entry.kind === "person" ? `person:${entry.group.key}` : `note:${entry.item.id}`), ["note:a", "person:unknown:a", "note:b", "person:unknown:b"]);
});

test("new person proposals do not hide individual notes from review", () => {
  const notes = [note("a", "Kyle"), note("b", "Kyle", "needs_review"), note("c", "Kyle")];
  assert.equal(groupPotentialPeople(notes, []).length, 1);
  assert.deepEqual(partitionNotesForReview(notes).needsReview.map(item => item.id), ["a", "b", "c"]);
});

test("after person approval, notes keep their individual review status", () => {
  const notes = [note("a", "Kyle", "ready", "kyle-id"), note("b", "Kyle", "needs_review", "kyle-id")];
  assert.equal(groupPotentialPeople(notes, [{ id: "kyle-id", name: "Kyle" }]).length, 0);
  assert.deepEqual(partitionNotesForReview(notes).ready.map(item => item.id), ["a"]);
  assert.deepEqual(partitionNotesForReview(notes).needsReview.map(item => item.id), ["b"]);
});

test("unified review queue puts one person row directly after all their independent notes", () => {
  const notes = [note("a", "Kyle"), note("x", "Sarah", "needs_review", "sarah-id"), note("b", "Kyle", "needs_review"), note("c", "Michael", "needs_review")];
  const groups = groupPotentialPeople(notes, [{ id: "sarah-id", name: "Sarah" }]);
  const queue = buildUnifiedReviewQueue(partitionNotesForReview(notes).needsReview, groups);
  assert.deepEqual(queue.map(entry => entry.kind === "person" ? `person:${entry.group.name}` : `note:${entry.item.id}`), [
    "note:a", "note:b", "person:Kyle", "note:x", "note:c", "person:Michael",
  ]);
});

test("approving a person removes only their person row and preserves uncertain notes", () => {
  const before = [note("a", "Kyle"), note("b", "Kyle", "needs_review")];
  const firstQueue = buildUnifiedReviewQueue(partitionNotesForReview(before).needsReview, groupPotentialPeople(before, []));
  assert.equal(firstQueue.length, 3);
  const after = before.map(item => ({ ...item, contactId: "kyle-id" }));
  const secondQueue = buildUnifiedReviewQueue(partitionNotesForReview(after).needsReview, groupPotentialPeople(after, [{ id: "kyle-id", name: "Kyle" }]));
  assert.deepEqual(secondQueue.map(entry => entry.kind === "note" ? entry.item.id : "unexpected person"), ["b"]);
  assert.deepEqual(partitionNotesForReview(after).ready.map(item => item.id), ["a"]);
});

test("an approved fact waits on its person's identity without reappearing as an unreviewed fact", () => {
  const facts = [note("a", "Kyle", "approved_pending_person"), note("b", "Kyle", "needs_review")];
  const queue = buildUnifiedReviewQueue(partitionNotesForReview(facts).needsReview, groupPotentialPeople(facts, []));
  assert.deepEqual(queue.map(entry => entry.kind === "person" ? "person:Kyle" : `note:${entry.item.id}`), ["note:b", "person:Kyle"]);
  const allApproved = [note("a", "Kyle", "approved_pending_person")];
  const identityOnly = buildUnifiedReviewQueue(partitionNotesForReview(allApproved).needsReview, groupPotentialPeople(allApproved, []));
  assert.deepEqual(identityOnly.map(entry => entry.kind), ["person"]);
});

test("an approved ambiguous or anonymous fact still has its person row", () => {
  const facts = [note("j", "Jason", "approved_pending_person"), note("u", "Unattributed", "approved_pending_person")];
  const people = [{ id: "j1", name: "Jason Lee" }, { id: "j2", name: "Jason Kim" }];
  const groups = groupPotentialPeople(facts, people);
  const queue = buildUnifiedReviewQueue(partitionNotesForReview(facts).needsReview, groups);
  assert.deepEqual(queue.map(entry => entry.kind === "person" ? entry.group.key : "unexpected fact"), ["jason", "unknown:u"]);
});

test("speaker choices include only named pending people from the supplied gathering", () => {
  const notes = [note("a", "Unattributed"), note("k", "Kyle"), note("s", "Sarah", "needs_review", "existing-sarah")];
  const groups = groupPotentialPeople(notes, [{ id: "existing-sarah", name: "Sarah" }]);
  assert.deepEqual(eligiblePendingSpeakers(groups).map(group => group.name), ["Kyle"]);
});

test("speaker selector appears for unclear attribution, not every fact", () => {
  assert.equal(needsSpeakerSelection({ ...note("a", "Unattributed"), reason: "Who shared this?" }), true);
  assert.equal(needsSpeakerSelection({ ...note("b", "Kyle"), reason: "Multiple people mentioned — check attribution" }), true);
  assert.equal(needsSpeakerSelection({ ...note("c", "Kyle"), reason: "Matched confidently" }), false);
  assert.equal(needsSpeakerSelection({ ...note("d", "Jason"), reason: "Multiple possible contacts" }), false);
});

test("rejecting a person hides that person's proposed facts without hiding confirmed memories", () => {
  const notes = [note("a", "Kyle", "rejected"), note("b", "Kyle", "rejected"), note("c", "Sarah", "confirmed", "sarah-id")];
  assert.deepEqual(groupPotentialPeople(notes, []).map(group => group.name), []);
  assert.deepEqual(partitionNotesForReview(notes).needsReview, []);
  assert.deepEqual(partitionNotesForReview(notes).confirmed.map(item => item.id), ["c"]);
});
