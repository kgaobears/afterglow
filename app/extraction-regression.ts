import type { FactType } from "./fact-type";
import { consolidateAtomicMemories } from "./atomization";

export type ExtractionMemory = { name: string; detail: string; factType?: FactType; verification?: string };
export type ExpectedAtomicFact = { label: string; person: string; signals: string[]; factType: FactType; rejectSignals?: string[]; reviewRequired?: boolean };
export type ForbiddenFact = { label: string; person?: string; signals: string[] };
export type ExtractionFixture = { id: string; title: string; note: string; date: string; expected: ExpectedAtomicFact[]; optional?: ExpectedAtomicFact[]; forbidden?: ForbiddenFact[] };

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
  {
    id: "named_relatives",
    title: "Multiple named relatives and a visit",
    note: "Kyle has an older brother named Francis who lives in San Francisco. His younger sister Emily just moved to Seattle. Kyle visited Francis last weekend.",
    date: "2026-11-08",
    expected: [
      { label: "Francis is Kyle's older brother", person: "Kyle", signals: ["Francis", "brother", "older"], factType: "profile" },
      { label: "Emily is Kyle's younger sister", person: "Kyle", signals: ["Emily", "sister", "younger"], factType: "profile" },
      { label: "Francis lives in San Francisco", person: "Francis", signals: ["liv(?:es|ing)", "(?:San Francisco|\\bSF\\b)"], factType: "profile" },
      { label: "Emily moved to Seattle", person: "Emily", signals: ["mov", "Seattle"], factType: "timeline" },
      { label: "Kyle visited Francis", person: "Kyle", signals: ["visit", "Francis", "weekend"], factType: "timeline" },
    ],
    forbidden: [
      { label: "Francis visited Kyle (reversed)", signals: ["Francis", "visited Kyle"] },
      { label: "Francis has older brother Kyle (reversed)", person: "Francis", signals: ["\\b(?:has|have)\\s+(?:an?\\s+)?older brother (?:named )?Kyle\\b"] },
      { label: "Emily has younger sister Kyle (reversed)", person: "Emily", signals: ["\\b(?:has|have)\\s+(?:an?\\s+)?younger sister (?:named )?Kyle\\b"] },
    ],
  },
  {
    id: "ambiguous_pronoun",
    title: "Ambiguous promotion remains unattributed for review",
    note: "I talked to Jason and Michael yesterday. He said he just got promoted. Michael also mentioned he's moving to Texas.",
    date: "2026-11-08",
    expected: [
      { label: "Michael moving to Texas", person: "Michael", signals: ["mov", "Texas"], factType: "timeline" },
      { label: "Unattributed promotion for review", person: "Unattributed", signals: ["promot"], factType: "timeline", reviewRequired: true },
    ],
    forbidden: [
      { label: "Promotion assigned to Jason", person: "Jason", signals: ["promot"] },
      { label: "Promotion assigned to Michael", person: "Michael", signals: ["promot"] },
    ],
  },
  {
    id: "temporary_states",
    title: "Job change and temporary accommodation",
    note: "Sarah used to work at Google, but she recently joined Apple. She's staying with her parents for a few weeks while looking for an apartment in Cupertino.",
    date: "2026-11-08",
    expected: [
      { label: "Sarah joined Apple", person: "Sarah", signals: ["(?:join|start|new job)", "Apple"], factType: "timeline" },
      { label: "Sarah works at Apple", person: "Sarah", signals: ["(?:works?|employed|job)", "Apple"], factType: "profile" },
      { label: "Sarah temporarily stays with parents", person: "Sarah", signals: ["(?:stay|staying|living)", "parents"], factType: "timeline" },
      { label: "Sarah seeks apartment in Cupertino", person: "Sarah", signals: ["(?:look|search|seek)", "apartment", "Cupertino"], factType: "timeline" },
    ],
    optional: [{ label: "Sarah used to work at Google", person: "Sarah", signals: ["(?:used to|previous|former)", "Google"], factType: "profile" }],
    forbidden: [{ label: "Sarah currently works at Google", person: "Sarah", signals: ["(?:currently|now|still) works? at Google"] }],
  },
  {
    id: "self_correction",
    title: "A correction overrides an earlier destination",
    note: "Michael told me he's moving to New York next month. Actually, he corrected himself—he's moving to Boston instead. His wife already found a job there.",
    date: "2026-11-08",
    expected: [
      { label: "Michael moving to Boston", person: "Michael", signals: ["mov", "Boston"], factType: "timeline" },
      { label: "Michael's wife found a job in Boston", person: "Michael", signals: ["wife", "job", "Boston"], factType: "timeline" },
    ],
    forbidden: [
      { label: "Discarded New York destination", signals: ["mov", "New York"] },
      { label: "Fabricated unnamed wife contact", person: "Michael's wife", signals: ["job"] },
    ],
  },
  {
    id: "hypotheticals",
    title: "Negated job change and tentative restaurant plan",
    note: "Jason considered quitting his job to start a restaurant, but ultimately decided against it. He's still working at Microsoft. He might try opening a restaurant next year.",
    date: "2026-11-08",
    expected: [
      { label: "Jason still works at Microsoft", person: "Jason", signals: ["(?:work|employ)", "Microsoft"], factType: "profile" },
      { label: "Jason might open restaurant", person: "Jason", signals: ["restaurant", "(?:might|may|consider|possibly|potential|thinking|interest|try|tentative)"], factType: "timeline" },
    ],
    forbidden: [
      { label: "Jason quit his job", person: "Jason", signals: ["(?:quit|left|resigned)(?: his)? job"] },
      { label: "Jason already opened a restaurant", person: "Jason", signals: ["(?:started|opened|founded) (?:a |his )?restaurant"] },
    ],
  },
  {
    id: "multiple_dates",
    title: "Distinct past milestones and future wedding",
    note: "Emily graduated from Berkeley in 2022, started working at Nvidia in 2023, and got engaged last weekend. Her wedding is planned for next June.",
    date: "2026-11-08",
    expected: [
      { label: "Emily graduated in 2022", person: "Emily", signals: ["graduat", "Berkeley", "2022"], factType: "timeline" },
      { label: "Emily started at Nvidia in 2023", person: "Emily", signals: ["(?:start|join)", "Nvidia", "2023"], factType: "timeline" },
      { label: "Emily got engaged last weekend", person: "Emily", signals: ["engag", "weekend"], factType: "timeline" },
      { label: "Emily wedding planned next June", person: "Emily", signals: ["(?:wedding|marri)", "June"], factType: "timeline" },
    ],
    optional: [{ label: "Emily works at Nvidia", person: "Emily", signals: ["work", "Nvidia"], factType: "profile" }],
  },
  {
    id: "semantic_duplicates",
    title: "Rephrased residence merges without losing duration",
    note: "Kyle's brother Francis lives in San Francisco. Francis has been living in SF for three years. Kyle mentioned that his brother still lives there.",
    date: "2026-11-08",
    expected: [
      { label: "Kyle has brother Francis", person: "Kyle", signals: ["brother", "Francis"], factType: "profile" },
      { label: "Francis lives in SF for three years", person: "Francis", signals: ["(?:San Francisco|\\bSF\\b)", "(?:three|3) years"], factType: "profile" },
    ],
  },
  {
    id: "conversation_topics",
    title: "Conversation topics are not invented beliefs",
    note: "I saw Daniel at church on Sunday. We talked about how expensive housing has become. He mentioned his daughter just bought her first house in Fremont. We also discussed whether AI will replace software engineers.",
    date: "2026-11-08",
    expected: [
      { label: "Daniel has a daughter", person: "Daniel", signals: ["daughter"], factType: "profile" },
      { label: "Daniel's daughter bought a house", person: "Daniel", signals: ["daughter", "(?:bought|purchased)", "house", "Fremont"], factType: "timeline" },
    ],
    forbidden: [
      { label: "Fabricated unnamed daughter contact", person: "Daniel's daughter", signals: ["house"] },
      { label: "Invented Daniel housing opinion", person: "Daniel", signals: ["(?:believes?|thinks?|concerned|worried).*(?:housing|expensive)"] },
      { label: "Invented Daniel AI prediction", person: "Daniel", signals: ["(?:believes?|thinks?|predicts?).*AI.*replace"] },
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
  forbiddenMatches: string[];
  wrongReview: string[];
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
  const wrongReview = fixture.expected.filter((item, index) => item.reviewRequired && matched.has(index) && memories[matched.get(index)!].verification !== "review").map(item => item.label);
  const forbiddenMatches = (fixture.forbidden || []).filter(item => memories.some(memory =>
    (!item.person || memory.name.trim().toLowerCase() === item.person.toLowerCase())
    && item.signals.every(signal => new RegExp(signal, "i").test(memory.detail)))).map(item => item.label);
  return {
    covered: matched.size,
    total: fixture.expected.length,
    correctlyTyped: matched.size - wrongType.length,
    missing,
    wrongType,
    matchingMemoryIndices: [...matched.values()],
    redundantCount: memories.length - consolidateAtomicMemories(memories.map(memory => ({ ...memory, quote: "", factType: memory.factType ?? "profile" })), fixture.note).length,
    forbiddenMatches,
    wrongReview,
  };
}
