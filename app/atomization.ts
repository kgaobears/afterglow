import type { SourceMemory } from "./source-verification";
import { inferFactType } from "./fact-type";
import { attachNamedRelativeUpdates, preserveRelationshipDirections } from "./relationship-anchors";

// Small models sometimes repeat a comma-separated list of milestones instead
// of splitting it. Split only explicit, independently completed actions; leave
// related context (residence, relatives, motivations) bundled.
export function splitIndependentEvents(memory: SourceMemory): SourceMemory[] {
  const clauses = memory.detail.split(/,\s*(?:and\s+)?(?=(?:graduated|started|joined|got|moved|visited|became|was hired)\b)/i);
  if (clauses.length < 2 || !/\b(?:graduated|started|joined|got engaged|moved|visited)\b/i.test(clauses[0])) return [memory];
  return clauses.map(detail => ({ ...memory, detail: detail.trim(), quote: "", factType: inferFactType(detail.trim(), "timeline") }));
}

// An explicit correction changes the destination of an already stated move.
// This deliberately does not attempt to resolve ambiguous pronouns or infer
// implicit contradictions; those remain the user's responsibility.
export function discardExplicitlySupersededMoves(candidates: SourceMemory[], source: string): SourceMemory[] {
  const correction = /\b([A-Z][a-z]+)\b[^.!?]{0,100}\bmov(?:ing|es|e)\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b[\s\S]{0,180}?\b(?:actually|corrected|correction)\b[\s\S]{0,150}?\bmov(?:ing|es|e)\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+instead/gi;
  const superseded = [...source.matchAll(correction)].map(match => ({ person: match[1].toLowerCase(), oldPlace: match[2], newPlace: match[3] }));
  return candidates.filter(memory => !superseded.some(({ person, oldPlace, newPlace }) =>
    memory.name.trim().toLowerCase() === person
    && new RegExp(`\\bmov(?:ing|es|e)\\s+to\\s+${oldPlace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(memory.detail)
    && !new RegExp(`\\b${newPlace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(memory.detail)));
}

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
    if (item.factType === "timeline") return item;
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

// Consolidate repeated model suggestions without asking the model to rewrite
// facts yet again. Keep the shorter standalone facts when, together, they
// fully cover a compound profile note. Never remove a compound if any of its
// meaningful terms would be lost, and never merge distinct timeline events.
export function consolidateAtomicMemories(candidates: SourceMemory[], source: string): SourceMemory[] {
  const normalized = normalizeRelationalCoverage(discardExplicitlySupersededMoves(candidates, source), source, candidates);
  const normalizedText = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const sourceText = normalizedText(source);
  const supported = preserveRelationshipDirections(normalized, source).filter(item => {
    if (item.factType !== "timeline") return true;
    // Some small models reverse the visitor and invent a separate relative
    // contact. Discard only when the source explicitly says the reverse event.
    const match = item.name.match(/^(.+?)[’']s (brother|sister|son|daughter|mother|father)$/i);
    if (!match) return true;
    const owner = match[1], relative = match[2];
    const reversed = new RegExp(`^${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[’']s ${relative} visited ${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (!reversed.test(item.detail)) return true;
    return !new RegExp(`\\b${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} visited (?:his|her|their) ${relative}\\b`, "i").test(sourceText);
  });
  const attached = attachNamedRelativeUpdates(supported, source);
  const unique = mergeCoverageCandidates([], attached.filter(item => !/^(?:has|have|is|was|were|their|his|her|visited|moved|started)\s+.{8,}/i.test(item.name)).map(item => ({ ...item, factType: inferFactType(item.detail, item.factType) })));
  const stopwords = new Set(["a", "an", "the", "has", "have", "is", "are", "was", "were", "who", "that", "and", "his", "her", "their", "him", "them", "than", "in", "at", "to", "of"]);
  const terms = (value: string) => new Set(normalizedText(value).split(" ").filter(token => token && !stopwords.has(token)));
  return unique.filter((item, index) => {
    if (item.factType !== "profile" || !/\b(?:and|who|while)\b|;|,(?=\s*\w)/i.test(item.detail)) return true;
    const target = terms(item.detail);
    if (target.size < 4) return true;
    const covered = new Set<string>();
    let contributing = 0;
    for (const [otherIndex, other] of unique.entries()) {
      if (index === otherIndex || other.factType !== item.factType || normalizedText(other.name) !== normalizedText(item.name)) continue;
      const otherTerms = terms(other.detail);
      if (otherTerms.size >= target.size) continue;
      const intersection = [...otherTerms].filter(token => target.has(token));
      if (intersection.length < 2 || intersection.length < otherTerms.size * 0.7) continue;
      contributing++;
      intersection.forEach(token => covered.add(token));
    }
    return !(contributing >= 2 && [...target].every(token => covered.has(token)));
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
