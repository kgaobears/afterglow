import { timelineSortDate, validDate, type TemporalFields } from "./temporal-facts";

export type TimelineMemory = TemporalFields & { id: string; body: string; date: string };
export type Conversation = { id: string; title: string; date: string; groupName?: string };
export type TimelinePoint =
  | { kind: "event"; key: string; date: string; memory: TimelineMemory }
  | { kind: "conversation"; key: string; date: string; conversation: Conversation };

export function contactTimelinePoints(memories: TimelineMemory[], conversations: Conversation[]): TimelinePoint[] {
  const events: TimelinePoint[] = memories.map(memory => ({
    kind: "event", key: `event:${memory.id}`, date: timelineSortDate(memory), memory,
  }));
  const talks: TimelinePoint[] = conversations.filter(conversation => validDate(conversation.date)).map(conversation => ({
    kind: "conversation", key: `talk:${conversation.id}`, date: conversation.date, conversation,
  }));
  // On a shared date, show when you talked before the event details.
  return [...events, ...talks].sort((a, b) => b.date.localeCompare(a.date) ||
    (a.kind === "conversation" ? -1 : 1) - (b.kind === "conversation" ? -1 : 1) || a.key.localeCompare(b.key));
}

export function timelineDateLabel(date: string): string {
  if (!validDate(date)) return "Date unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00.000Z`));
}
