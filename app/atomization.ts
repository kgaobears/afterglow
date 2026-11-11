import type { SourceMemory } from "./source-verification";
import { inferFactType } from "./fact-type";

// If a small on-device model cannot complete the atomization pass, preserve
// concise candidates from its first response. The short `quote` field from
// older responses was often a generated summary, not a literal quotation.
export function fallbackAtomize(initial: SourceMemory[]): SourceMemory[] {
  return initial.flatMap(memory => {
    const sentences = memory.detail.trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
    const conciseQuote = memory.quote.trim().length >= 8 && memory.quote.trim().length <= 200
      ? memory.quote.trim() : "";
    if (sentences.length > 1) {
      return sentences.map((sentence, index) => ({
        name: memory.name,
        detail: index === sentences.length - 1 && conciseQuote ? conciseQuote : sentence,
        quote: "",
        // A combined relationship + visit must split into different kinds.
        factType: inferFactType(index === sentences.length - 1 && conciseQuote ? conciseQuote : sentence),
      }));
    }
    const detail = conciseQuote || memory.detail.trim();
    return [{ name: memory.name, detail, quote: "", factType: inferFactType(detail, memory.factType) }];
  });
}

// Preserve people the atomizer accidentally omitted without repeating people
// already represented in its result. The fallback can still be reviewed.
export function retainMissingPeople(atomized: SourceMemory[], initial: SourceMemory[]): SourceMemory[] {
  const named = new Set(atomized.map(memory => memory.name.trim().toLowerCase()));
  const missing = initial.filter(memory => !named.has(memory.name.trim().toLowerCase()));
  return [...atomized, ...fallbackAtomize(missing)];
}

// An atomizer is additive, not authoritative: it may accidentally reverse the
// actor in an already atomic first-pass event. Keep those originals intact.
// Compound first-pass summaries stay out of this merge; their split atoms
// remain available from the atomizer/coverage passes.
export function preserveInitialAtoms(atomized: SourceMemory[], initial: SourceMemory[]): SourceMemory[] {
  const standalone = initial.filter(memory => !/[.!?]\s+[A-Z]/.test(memory.detail));
  return mergeCoverageCandidates(atomized, standalone);
}

// A coverage pass may independently rediscover details lost by the first
// extraction. Keep its genuinely new candidate rows without deleting or
// modifying any earlier candidate. Semantic duplicates remain user-reviewable.
export function mergeCoverageCandidates(candidates: SourceMemory[], missing: SourceMemory[], limit = 40): SourceMemory[] {
  const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const seen = new Set(candidates.map(item => `${normalized(item.name)}|${normalized(item.detail)}`));
  const merged = [...candidates];
  for (const item of missing) {
    if (!item.name.trim() || !item.detail.trim()) continue;
    const key = `${normalized(item.name)}|${normalized(item.detail)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged.slice(0, limit);
}

// The coverage model sometimes creates a new contact named "Kyle's brother"
// when the note only identifies Kyle. Those details belong on Kyle's profile,
// not on a fabricated contact. Correct only an explicitly possessive relative
// of a known speaker; named relatives remain independent people.
export function normalizeRelationalCoverage(missing: SourceMemory[], source: string, existing: SourceMemory[]): SourceMemory[] {
  const known = new Map(existing.map(item => [item.name.toLowerCase(), item.name]));
  const relative = /^(.+?)[’']s (brother|sister|daughter|son|mother|father|wife|husband|partner|parent|child)$/i;
  return missing.map(item => {
    const match = item.name.match(relative);
    if (!match) return item;
    const owner = known.get(match[1].toLowerCase());
    if (!owner || !new RegExp(`\\b${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(source)) return item;
    const relationship = match[2].toLowerCase();
    const detail = new RegExp(`\\b${relationship}\\b`, "i").test(item.detail)
      ? item.detail
      : `Their ${relationship} ${item.detail.replace(/^(?:he|she|they)\s+/i, "").replace(/^([A-Z])/, letter => letter.toLowerCase())}`;
    return { ...item, name: owner, detail, factType: inferFactType(detail, item.factType) };
  });
}

// A compact index-only audit avoids rewording the memories during checking.
// Out-of-range, fractional and duplicate indices are ignored.
export function acceptedAuditCandidates(output: unknown, candidates: SourceMemory[]): SourceMemory[] {
  if (!output || typeof output !== "object" || !("accepted" in output)) return [];
  const values = (output as { accepted: unknown }).accepted;
  if (!Array.isArray(values)) return [];
  const unique = new Set<number>();
  for (const value of values) {
    const index = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < candidates.length) unique.add(index);
  }
  return [...unique].map(index => candidates[index]);
}
