import { buildUnifiedReviewQueue, groupPotentialPeople, type CandidateNote, type KnownContact } from "./pending-people";

export type InboxSession = { id: string; title: string; groupName: string; date: string; createdAt: number };
export type InboxNote = CandidateNote & { gatheringId: string; reason: string; createdAt: number };

export function countReviewItems(items: Array<CandidateNote & { gatheringId?: string }>): number {
  const outstanding = items.filter(item => item.status !== "confirmed" && item.status !== "rejected");
  const facts = outstanding.filter(item => item.status === "needs_review" || item.status === "ready").length;
  const byGathering = new Map<string, typeof outstanding>();
  for (const item of outstanding) {
    const id = item.gatheringId || "";
    byGathering.set(id, [...(byGathering.get(id) || []), item]);
  }
  return facts + [...byGathering.values()].reduce((count, notes) => count + groupPotentialPeople(notes, []).length, 0);
}

// The inbox is a view over the same captured_items rows used by Gatherings.
// Nothing is copied, moved or marked reviewed merely by opening this view.
export function buildReviewSections<T extends InboxNote>(sessions: InboxSession[], items: T[], people: KnownContact[]) {
  return sessions.map(session => {
    const outstanding = items.filter(item => item.gatheringId === session.id && item.status !== "confirmed" && item.status !== "rejected");
    const groups = groupPotentialPeople(outstanding, people);
    const notes = outstanding.filter(item => item.status === "needs_review" || item.status === "ready");
    const queue = buildUnifiedReviewQueue(notes, groups);
    return { session, groups, queue, count: queue.length, confident: notes.filter(item => item.status === "ready" && !!item.contactId) };
  }).filter(section => section.count > 0);
}
