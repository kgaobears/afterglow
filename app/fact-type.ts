export type FactType = "profile" | "timeline";

export const factTypeLabel: Record<FactType, string> = {
  profile: "Profile fact",
  timeline: "Timeline event",
};

export function validFactType(value: unknown): value is FactType {
  return value === "profile" || value === "timeline";
}

export function partitionContactMemories<T extends { factType?: unknown }>(items: T[]) {
  return {
    profile: items.filter(item => item.factType === "profile"),
    timeline: items.filter(item => item.factType !== "profile"),
  };
}

// A conservative fallback for small local models, older checkpoints and the
// immediate capture preview. Event cues take priority over a guessed label.
export function inferFactType(detail: string, suggestion?: unknown): FactType {
  const text = detail.trim().toLowerCase();
  const event = /\b(?:last|next|this|past)\s+(?:weekend|week|month|year|night|summer|spring|fall|winter|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:yesterday|tomorrow|today|recently|currently applying|applying to|preparing for|training for|planning to|plans to|going to|about to|this morning)\b|\b(?:visited|went to|traveled to|returned from|started|began|finished|completed|attended|celebrated|interviewed|applied|accepted an offer|got a new|changed jobs|moved to|bought|sold|won|ran a|is visiting|will visit)\b/i;
  if (event.test(text)) return "timeline";
  // A relative's age difference is an enduring relationship, even when a
  // small model labels it as an event or omits the verb "has".
  if (/\b(?:brother|sister|sibling|son|daughter|mother|father|parent|wife|husband|partner)\b.{0,55}\b(?:older|younger)\b|\b(?:older|younger)\b.{0,55}\b(?:brother|sister|sibling|son|daughter|mother|father|parent)\b/i.test(text)) return "profile";
  if (validFactType(suggestion)) return suggestion;
  const enduring = /\b(?:has|have)\s+(?:(?:an?|\d+|two|three|four|older|younger)\s+)?(?:brother|sister|sibling|child|children|son|daughter|wife|husband|spouse|partner|dog|cat|parents?)\b|\b(?:lives? in|is from|grew up in|works? (?:at|as|in|for)|is (?:an? )?(?:engineer|dentist|teacher|student|doctor|nurse|artist)|likes?|loves?|enjoys?|prefers?|favorite|speaks?|studied|majored in|is allergic to|has a degree in)\b/i;
  return enduring.test(text) ? "profile" : "timeline";
}

// The verification model can correct the atomizer's classification using
// index-only lists. Neither classification list can introduce a new memory.
export function applyAuditedFactTypes<T extends { detail: string; factType?: FactType }>(output: unknown, memories: T[]): T[] {
  if (!output || typeof output !== "object") return memories;
  const value = output as { profile?: unknown; timeline?: unknown };
  const indices = (array: unknown) => new Set(
    Array.isArray(array) ? array.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < memories.length) : [],
  );
  const profile = indices(value.profile);
  const timeline = indices(value.timeline);
  return memories.map((memory, i) => {
    if (profile.has(i) === timeline.has(i)) return memory;
    return { ...memory, factType: inferFactType(memory.detail, profile.has(i) ? "profile" : "timeline") };
  });
}
