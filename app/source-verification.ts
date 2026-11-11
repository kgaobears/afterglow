import type { FactType } from "./fact-type";
import type { TemporalFields } from "./temporal-facts";

export type SourceMemory = { name: string; detail: string; quote: string; factType?: FactType } & TemporalFields;
export type ReviewedMemory = SourceMemory & { verification: "verified" | "review" };
export type MemoryDecision = SourceMemory & { status: "verified" | "review" | "excluded"; reason: string; sourceMatch: boolean };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function structuralProblem(memory: SourceMemory): string | null {
  if (!memory.name.trim()) return "No person identified";
  if (!memory.detail.trim()) return "No memory detail extracted";
  return null;
}

// Literal overlap is diagnostic information. Atomized memories are usually
// paraphrases, so they must not require a verbatim quotation to be verified.
export function hasExactSupport(note: string, memory: SourceMemory): boolean {
  const original = normalize(note);
  return [memory.quote, memory.detail].some(text => text.trim().length >= 8 && original.includes(normalize(text)));
}

function identity(memory: SourceMemory): string {
  return `${normalize(memory.name)}\u0000${normalize(memory.detail)}`;
}

// Decisions explain why each first-pass candidate was accepted, held for
// review, or excluded. These details only live in browser memory.
export function inspectSourceMemories(
  note: string,
  initial: SourceMemory[],
  audited: SourceMemory[],
): MemoryDecision[] {
  const confirmed = new Set(audited.filter(memory => !structuralProblem(memory)).map(identity));
  const seen = new Set<string>();
  const result: MemoryDecision[] = [];
  for (const memory of initial) {
    const problem = structuralProblem(memory);
    const sourceMatch = hasExactSupport(note, memory);
    if (problem) {
      result.push({ ...memory, status: "excluded", reason: problem, sourceMatch });
      continue;
    }
    const key = identity(memory);
    if (seen.has(key)) {
      result.push({ ...memory, status: "excluded", reason: "Duplicate of another candidate", sourceMatch });
      continue;
    }
    seen.add(key);
    const verified = confirmed.has(key);
    result.push({ ...memory, status: verified ? "verified" : "review",
      reason: verified ? "The verification pass confirmed this atomic memory" :
        "The verification pass couldn't confidently confirm this memory — compare with the original note", sourceMatch });
  }
  return result;
}

// The first pass owns the candidate list. The audit can confirm a candidate,
// but cannot silently delete plausible memories or invent replacements.
// Unconfirmed claims stay review-only; verbatim wording is not required.
export function reconcileSourceMemories(note: string, initial: SourceMemory[], audited: SourceMemory[]): ReviewedMemory[] {
  return inspectSourceMemories(note, initial, audited)
    .filter(memory => memory.status !== "excluded")
    .map(({ status, reason: _reason, sourceMatch: _sourceMatch, ...memory }) => ({ ...memory, verification: status === "verified" ? "verified" : "review" }));
}
