import type { FactType } from "./fact-type";
import type { TemporalFields } from "./temporal-facts";

export type KnownContact = { id: string; name: string };
export type CandidateNote = { id: string; name: string; contactId: string | null; status: string; detail: string; factType?: FactType } & TemporalFields;

export type PendingPersonGroup<T extends CandidateNote = CandidateNote> = {
  key: string;
  name: string;
  existingContactId: string | null;
  matchCount: number;
  items: T[];
};

const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

// Every unlinked fact has a person-review row, including ambiguous names.
// Unattributed facts get separate identity rows rather than being incorrectly
// grouped as if all unnamed speakers were one person.
export function groupPotentialPeople<T extends CandidateNote>(items: T[], people: KnownContact[]): PendingPersonGroup<T>[] {
  const groups = new Map<string, PendingPersonGroup<T>>();
  for (const item of items) {
    const name = item.name.trim();
    const key = normalized(name);
    if (item.contactId || item.status === "confirmed" || item.status === "rejected") continue;
    const unknown = !key || key === "unattributed";
    const groupKey = unknown ? `unknown:${item.id}` : key;
    const exact = unknown ? [] : people.filter(person => normalized(person.name) === key);
    const matched = unknown ? [] : exact.length ? exact : people.filter(person => normalized(person.name.split(/\s+/)[0]) === key);
    const group = groups.get(groupKey) ?? { key: groupKey, name: unknown ? "Unknown person" : name, existingContactId: matched.length === 1 ? matched[0].id : null, matchCount: matched.length, items: [] };
    group.items.push(item);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

export function eligiblePendingSpeakers<T extends CandidateNote>(groups: PendingPersonGroup<T>[]) {
  return groups.filter(group => group.name !== "Unknown person");
}

export function needsSpeakerSelection(note: CandidateNote & { reason?: string }) {
  return normalized(note.name) === "unattributed" || !normalized(note.name) ||
    /(?:attribution|who shared|speaker unknown|multiple people mentioned|check who this refers to|speaker selected)/i.test(note.reason || "");
}

// An explicitly approved fact awaiting its person's identity is not a second
// fact-review task. Its proposed person remains separately actionable.
export function partitionNotesForReview<T extends CandidateNote>(items: T[]) {
  return {
    ready: items.filter(item => item.status === "ready" && !!item.contactId),
    needsReview: items.filter(item => item.status === "needs_review" || (item.status === "ready" && !item.contactId)),
    confirmed: items.filter(item => item.status === "confirmed"),
  };
}

export type ReviewQueueEntry<T extends CandidateNote = CandidateNote> =
  | { kind: "person"; group: PendingPersonGroup<T> }
  | { kind: "note"; item: T };

// Let the user read all of a person's facts before deciding whether the person
// is new or should merge with an existing contact. Preserve independent fact
// decisions and keep each identity row immediately after its associated facts.
export function buildUnifiedReviewQueue<T extends CandidateNote>(notes: T[], groups: PendingPersonGroup<T>[]): ReviewQueueEntry<T>[] {
  const byId = new Map(notes.map(note => [note.id, note]));
  const groupForNote = new Map(groups.flatMap(group => group.items.map(item => [item.id, group] as const)));
  const shownGroups = new Set<string>();
  const entries: ReviewQueueEntry<T>[] = [];
  for (const note of notes) {
    const group = groupForNote.get(note.id);
    if (!group) {
      entries.push({ kind: "note", item: note });
      continue;
    }
    if (shownGroups.has(group.key)) continue;
    shownGroups.add(group.key);
    for (const member of group.items) {
      const item = byId.get(member.id);
      if (item) entries.push({ kind: "note", item });
    }
    entries.push({ kind: "person", group });
  }
  // Every fact might already have been approved while the proposed person is
  // still pending. The identity row must remain visible in that case.
  for (const group of groups) {
    if (!shownGroups.has(group.key)) entries.push({ kind: "person", group });
  }
  return entries;
}
