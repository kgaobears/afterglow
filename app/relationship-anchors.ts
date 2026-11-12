import type { SourceMemory } from "./source-verification";

export type RelationshipAnchor = { owner: string; relation: string; relative: string };

// This is intentionally narrow: only explicit, named family links become
// authoritative. Unresolved pronouns and unnamed relatives are not guessed.
export function explicitRelationshipAnchors(source: string): RelationshipAnchor[] {
  const anchors: RelationshipAnchor[] = [];
  const push = (owner: string, relation: string, relative: string) => {
    if (!anchors.some(a => a.owner === owner && a.relation === relation && a.relative === relative))
      anchors.push({ owner, relation, relative });
  };
  const named = /\b([A-Z][a-z]+) has (?:an? )?((?:older|younger)\s+)?(brother|sister|son|daughter) (?:named )?([A-Z][a-z]+)\b/g;
  for (const match of source.matchAll(named)) push(match[1], `${match[2] || ""}${match[3]}`.trim(), match[4]);

  // "His younger sister Emily" can refer back to the explicit subject of a
  // nearby named family statement. Do not resolve it if that subject is absent.
  const possessive = /\b(His|Her|Their) ((?:older|younger)\s+)?(brother|sister|son|daughter) ([A-Z][a-z]+)\b/g;
  for (const match of source.matchAll(possessive)) {
    const prior = [...source.slice(0, match.index).matchAll(named)].at(-1);
    if (prior) push(prior[1], `${match[2] || ""}${match[3]}`.trim(), match[4]);
  }
  return anchors;
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function contradictsRelationshipDirection(memory: SourceMemory, anchors: RelationshipAnchor[]): boolean {
  return anchors.some(anchor => {
    if (memory.name.toLowerCase() !== anchor.relative.toLowerCase()) return false;
    const relation = anchor.relation.split(" ");
    const type = relation.at(-1)!;
    const degree = relation.length > 1 ? `${relation[0]}\\s+` : "(?:older\\s+|younger\\s+)?";
    const invented = new RegExp(`\\b(?:has|have)\\s+(?:an?\\s+)?${degree}${type}\\s+(?:named\\s+)?${escapeRegExp(anchor.owner)}\\b`, "i");
    // A separately asserted reciprocal relationship is not contradicted by
    // this anchor. Only block an invented reverse direction.
    const reciprocal = anchors.some(other => other.owner.toLowerCase() === anchor.relative.toLowerCase()
      && other.relative.toLowerCase() === anchor.owner.toLowerCase() && other.relation === anchor.relation);
    return !reciprocal && invented.test(memory.detail);
  });
}

export function preserveRelationshipDirections(memories: SourceMemory[], source: string): SourceMemory[] {
  const anchors = explicitRelationshipAnchors(source);
  return anchors.length ? memories.filter(memory => !contradictsRelationshipDirection(memory, anchors)) : memories;
}
