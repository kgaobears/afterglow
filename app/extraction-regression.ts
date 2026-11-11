import type { FactType } from "./fact-type";
import { consolidateAtomicMemories } from "./atomization";

export type ExtractionMemory = { name: string; detail: string; factType?: FactType };
export type ExpectedAtomicFact = { label: string; person: string; signals: string[]; factType: FactType; rejectSignals?: string[] };
export type ExtractionFixture = { id: string; title: string; note: string; date: string; expected: ExpectedAtomicFact[] };

// Deliberately small, realistic examples. Extend this list when a real note
// reveals a new failure mode. Only fictional examples belong in source code.
export const EXTRACTION_FIXTURES: ExtractionFixture[] = [
  {
    id: "kyle_brother",
    title: "Brother profile and visit timeline (SF is optional)",
    note: "Kyle has a brother who is two years older than him and lives in SF. Kyle visited his brother last weekend.",
    date: "2026-11-08",
    expected: [
      { label: "Has a brother two years older", person: "Kyle", signals: ["brother", "\\b(?:two|2)\\s+years?\\s+older\\b"], factType: "profile" },
      { label: "Kyle visited his brother last weekend", person: "Kyle", signals: ["brother", "\\b(?:visit(?:ed)?|went to see|saw)\\b", "(?:last|past|this) weekend"], rejectSignals: ["brother\\s+(?:visited|went to see|saw)\\s+Kyle"], factType: "timeline" },
    ],
  },
  {
    id: "church_group",
    title: "Three speakers, three separate updates",
    note: "At church, Jason said he started a new job. Sarah mentioned her daughter is applying to college. Michael is training for a marathon.",
    date: "2026-11-08",
    expected: [
      { label: "Jason started a new job", person: "Jason", signals: ["(?:new|started|changed|begin).*job|job.*(?:new|started)"], factType: "timeline" },
      { label: "Sarah's daughter applying to college", person: "Sarah", signals: ["daughter", "(?:applying|application|apply|college)"], factType: "timeline" },
      { label: "Michael training for marathon", person: "Michael", signals: ["marathon", "(?:training|train|preparing|prep)"], factType: "timeline" },
    ],
  },
];

export type ExtractionScore = {
  covered: number;
  total: number;
  correctlyTyped: number;
  missing: string[];
  wrongType: string[];
  matchingMemoryIndices: number[];
  redundantCount: number;
};

function matches(expected: ExpectedAtomicFact, memory: ExtractionMemory): boolean {
  return memory.name.trim().toLowerCase() === expected.person.toLowerCase()
    && expected.signals.every(signal => new RegExp(signal, "i").test(memory.detail))
    && !(expected.rejectSignals || []).some(signal => new RegExp(signal, "i").test(memory.detail));
}

// A single compound note MUST NOT pass several expected fact checks. Find a
// maximum one-to-one matching so the score is independent of output ordering.
export function scoreExtraction(fixture: ExtractionFixture, memories: ExtractionMemory[]): ExtractionScore {
  const owned = new Map<number, number>();
  const tryMatch = (expectedIndex: number, visited: Set<number>): boolean => {
    for (let index = 0; index < memories.length; index++) {
      if (visited.has(index) || !matches(fixture.expected[expectedIndex], memories[index])) continue;
      visited.add(index);
      const previousOwner = owned.get(index);
      if (previousOwner === undefined || tryMatch(previousOwner, visited)) {
        owned.set(index, expectedIndex);
        return true;
      }
    }
    return false;
  };
  fixture.expected.forEach((_, index) => { tryMatch(index, new Set()); });
  const matched = new Map([...owned].map(([memoryIndex, expectedIndex]) => [expectedIndex, memoryIndex]));
  const missing = fixture.expected.filter((_, index) => !matched.has(index)).map(item => item.label);
  const wrongType = fixture.expected.filter((item, index) => matched.has(index) && memories[matched.get(index)!].factType !== item.factType).map(item => item.label);
  return {
    covered: matched.size,
    total: fixture.expected.length,
    correctlyTyped: matched.size - wrongType.length,
    missing,
    wrongType,
    matchingMemoryIndices: [...matched.values()],
    redundantCount: memories.length - consolidateAtomicMemories(memories.map(memory => ({ ...memory, quote: "", factType: memory.factType ?? "profile" })), fixture.note).length,
  };
}
