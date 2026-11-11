import { inferFactType } from "./fact-type";
import type { SourceMemory } from "./source-verification";

// Local models sometimes return syntactically valid JSON with the entire fact
// in `name` and an empty `detail`. Reject that shape before it can appear as
// a misleading excluded fact in diagnostics or as an empty review queue.
export function parseMemories(output: unknown): SourceMemory[] {
  if (!output || typeof output !== "object" || !("memories" in output)) return [];
  const list = (output as { memories: unknown }).memories;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).filter(item => item && typeof item === "object" && typeof item.name === "string"
    && (typeof item.detail === "string" || typeof item.note === "string"))
    .map(item => {
      const detail = String(typeof item.note === "string" ? item.note : item.detail).trim().slice(0, 1000);
      return { name: String(item.name).trim().slice(0, 120), detail,
        quote: typeof item.quote === "string" ? item.quote.slice(0, 800) : "",
        factType: inferFactType(detail, item.factType) };
    })
    .filter(item => item.name.length > 0 && item.detail.length > 0);
}
