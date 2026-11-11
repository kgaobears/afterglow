import { inferFactType, type FactType } from "./fact-type";

export type TemporalNature = "attribute" | "current_state" | "event" | "ongoing" | "planned" | "unknown";
export type TemporalPrecision = "day" | "weekend" | "week" | "month" | "season" | "year" | "range" | "approximate";
export type TemporalCertainty = "exact" | "tentative";

export type TemporalFields = {
  temporalNature?: TemporalNature | null;
  timeStart?: string | null;
  timeEnd?: string | null;
  timePrecision?: TemporalPrecision | null;
  timeCertainty?: TemporalCertainty | null;
  timeExpression?: string | null;
};

export type DatedFact = TemporalFields & { detail: string; factType?: FactType };

const natures = new Set<TemporalNature>(["attribute", "current_state", "event", "ongoing", "planned", "unknown"]);
const precisions = new Set<TemporalPrecision>(["day", "weekend", "week", "month", "season", "year", "range", "approximate"]);
const certainties = new Set<TemporalCertainty>(["exact", "tentative"]);
const natureType: Record<Exclude<TemporalNature, "unknown">, FactType> = {
  attribute: "profile", current_state: "profile", event: "timeline", ongoing: "timeline", planned: "timeline",
};

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

// A model-proposed calendar date needs actual temporal evidence. In particular,
// "two years older" is not a date, and a gathering date alone proves no event date.
function hasTimeExpression(value: string) {
  return /\b(?:yesterday|today|tomorrow|recently|tonight|now|currently|earlier|soon|previously|since|until|before|after)\b|\b(?:last|next|this|past)\s+(?:weekend|week|month|year|spring|summer|fall|autumn|winter|night|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|\b(?:19|20)\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d+\s+(?:days?|weeks?|months?|years?)\s+ago\b/i.test(value);
}

function isEnduringRelationship(detail: string) {
  return /\b(?:has|have)\s+(?:(?:an?|\d+|two|three|four|older|younger)\s+)?(?:brother|sister|sibling|children?|sons?|daughters?|wife|husband|spouse|partner|parents?)\b/i.test(detail);
}

function relativeRange(expression: string, anchor: string) {
  const date = new Date(`${anchor}T00:00:00.000Z`);
  const shift = (days: number) => new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  if (/^yesterday$/i.test(expression)) return { start: shift(-1), end: null, precision: "day" as const };
  if (/^today$/i.test(expression)) return { start: anchor, end: null, precision: "day" as const };
  if (/^tomorrow$/i.test(expression)) return { start: shift(1), end: null, precision: "day" as const };
  const match = expression.toLowerCase().match(/^(last|this|next)\s+(weekend|week|month)$/);
  if (!match) return null;
  const [, when, period] = match;
  if (period === "month") {
    const y = date.getUTCFullYear(), m = date.getUTCMonth() + (when === "last" ? -1 : when === "next" ? 1 : 0);
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10), precision: "month" as const };
  }
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - mondayOffset * 86_400_000);
  const weekOffset = when === "last" ? -7 : when === "next" ? 7 : 0;
  const start = new Date(monday.getTime() + (weekOffset + (period === "weekend" ? 5 : 0)) * 86_400_000);
  const end = new Date(monday.getTime() + (weekOffset + 6) * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), precision: period as "week" | "weekend" };
}

function safeTemporalFields(raw: Record<string, unknown>, detail: string, originalNote: string, gatheringDate: string): TemporalFields {
  const time = raw.time && typeof raw.time === "object" && !Array.isArray(raw.time) ? raw.time as Record<string, unknown> : raw;
  const phrase = typeof time.expression === "string" ? time.expression.trim().replace(/[.,!?;:]+$/, "").slice(0, 90) : "";
  const source = `${detail}\n${originalNote}`;
  // The phrase must come from the source, not an invented timestamp.
  const supported = phrase.length >= 3 && normalized(source).includes(normalized(phrase)) && hasTimeExpression(phrase);
  if (!supported || !validDate(gatheringDate)) return {};

  let start = validDate(time.start) ? time.start : null;
  let end = validDate(time.end) ? time.end : null;
  if (start && end && end < start) { start = null; end = null; }
  if (!start && end) end = null;
  let precision = typeof time.precision === "string" && precisions.has(time.precision as TemporalPrecision)
    ? time.precision as TemporalPrecision : null;
  let certainty = typeof time.certainty === "string" && certainties.has(time.certainty as TemporalCertainty)
    ? time.certainty as TemporalCertainty : "tentative";
  // Relative and broad expressions aren't exact, even if a small model says so.
  if (/\b(?:last|next|this|past|recently|soon|around|approximately|early|late)\b/i.test(phrase) || precision && precision !== "day") certainty = "tentative";
  // A month/day without a stated year requires inference from the gathering.
  if (!/\b(?:19|20)\d{2}\b/.test(phrase) && /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(phrase)) certainty = "tentative";

  // Calendar arithmetic for clear relative phrases is deterministic. This
  // avoids letting a tiny on-device model guess the wrong year or weekend.
  const relative = relativeRange(phrase.toLowerCase(), gatheringDate);
  if (relative) {
    start = relative.start;
    end = relative.end;
    precision = relative.precision;
    if (precision !== "day") certainty = "tentative";
  }

  // Reject wildly distant guesses for short relative expressions, but keep the
  // phrase so the user still knows timing was tentative.
  if (/\b(?:yesterday|today|tomorrow|last weekend|next weekend|last week|next week)\b/i.test(phrase) && start) {
    const days = Math.abs(Date.parse(`${start}T00:00:00Z`) - Date.parse(`${gatheringDate}T00:00:00Z`)) / 86_400_000;
    if (days > 21) { start = null; end = null; }
  }
  return { timeStart: start, timeEnd: end, timeExpression: phrase, timePrecision: precision, timeCertainty: certainty };
}

// Repeat validation at the persistence boundary. The browser's local AI output
// is a suggestion, never trusted as an authoritative date or data schema.
export function sanitizeTemporalPayload(raw: Record<string, unknown>, detail: string, originalNote: string, gatheringDate: string): TemporalFields {
  const nature = typeof raw.temporalNature === "string" && natures.has(raw.temporalNature as TemporalNature)
    ? raw.temporalNature as TemporalNature : null;
  return { temporalNature: nature, ...safeTemporalFields({ time: {
    expression: raw.timeExpression, start: raw.timeStart, end: raw.timeEnd,
    precision: raw.timePrecision, certainty: raw.timeCertainty,
  } }, detail, originalNote, gatheringDate) };
}

// An extra offline inference pass annotates indexed existing atoms. It cannot
// invent, drop, merge, or rewrite a note. Missing or malformed indices preserve
// the previous classification and leave timing unknown.
export function applyTemporalAnnotations<T extends DatedFact>(
  output: unknown, facts: T[], gatheringDate: string, originalNote: string,
): T[] {
  if (!output || typeof output !== "object") return facts;
  const rows = (output as { items?: unknown }).items;
  if (!Array.isArray(rows)) return facts;
  const updates = new Map<number, T>();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const index = typeof entry.index === "string" && /^\d+$/.test(entry.index) ? Number(entry.index) : entry.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= facts.length || updates.has(index)) continue;
    const previous = facts[index];
    const nature = typeof entry.nature === "string" && natures.has(entry.nature as TemporalNature)
      ? entry.nature as TemporalNature : "unknown";
    const proposedType = nature === "unknown" ? previous.factType : natureType[nature];
    // Explicit family relationships must never become events just because the
    // model misreads an age difference as an elapsed time.
    const factType = isEnduringRelationship(previous.detail) && inferFactType(previous.detail) === "profile"
      ? "profile" : inferFactType(previous.detail, proposedType);
    const temporal = safeTemporalFields(entry, previous.detail, originalNote, gatheringDate);
    updates.set(index, { ...previous, temporalNature: nature, factType, ...temporal });
  }
  return facts.map((fact, i) => updates.get(i) ?? fact);
}

function readableDate(value: string, precision: TemporalPrecision | null | undefined) {
  if (!validDate(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (precision === "year") return String(date.getUTCFullYear());
  if (precision === "month" || precision === "season") return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function temporalHint(fact: TemporalFields): string | null {
  if (!fact.timeExpression && !fact.timeStart) return null;
  const phrase = fact.timeExpression ? `${fact.timeExpression.charAt(0).toUpperCase()}${fact.timeExpression.slice(1)}` : "";
  if (!fact.timeStart || !validDate(fact.timeStart)) return phrase ? `${phrase} · date unconfirmed` : null;
  const precision = fact.timePrecision;
  const samePeriod = fact.timeEnd && validDate(fact.timeEnd) &&
    (precision === "year" && fact.timeEnd.slice(0, 4) === fact.timeStart.slice(0, 4) ||
      (precision === "month" || precision === "season") && fact.timeEnd.slice(0, 7) === fact.timeStart.slice(0, 7));
  const range = fact.timeEnd && validDate(fact.timeEnd) && fact.timeEnd !== fact.timeStart && !samePeriod
    ? `${readableDate(fact.timeStart, precision)} – ${readableDate(fact.timeEnd, precision)}`
    : readableDate(fact.timeStart, precision);
  return `${phrase ? `${phrase} · ` : ""}${fact.timeCertainty === "tentative" ? "~" : ""}${range}`;
}

export function timelineSortDate(fact: TemporalFields & { date: string }): string {
  return validDate(fact.timeStart) ? fact.timeStart : fact.date;
}
