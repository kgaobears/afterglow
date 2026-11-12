#!/usr/bin/env node
// Compare untouched notes with lossless punctuation/conjunction formatting.
import { mkdir, writeFile } from "node:fs/promises";
import { extractLocally } from "../app/local-inference.ts";
import { EXTRACTION_FIXTURES, scoreExtraction } from "../app/extraction-regression.ts";

function segmentNote(note) {
  const segments = note
    .split(/(?<=[.!?])\s+(?=[A-Z])/u)
    .flatMap(sentence => sentence.split(/(?<=,)\s+(?=(?:but|then)\s+\w+\s+\w+)/iu))
    .map(segment => segment.trim())
    .filter(Boolean);
  // Preserve the word "but"/"then" on the second segment and punctuation
  // on the first, so corrections and temporal relationships remain visible.
  return segments.map((segment, index) => `[${index + 1}] ${segment}`).join("\n");
}

const repeats = Number(process.env.AFTERGLOW_SPLIT_REPEATS || 2);
const endpoint = (process.env.AFTERGLOW_LLM_ENDPOINT || "http://127.0.0.1:11434/v1").replace(/\/+$/, "");
const model = process.env.AFTERGLOW_LLM_MODEL || "qwen2.5:1.5b";
const results = [];

async function complete(messages, maxTokens) {
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Model returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).choices[0].message.content;
}

for (let round = 1; round <= repeats; round++) {
  for (const fixture of EXTRACTION_FIXTURES) {
    for (const mode of round % 2 ? ["original", "segmented"] : ["segmented", "original"]) {
      const note = mode === "segmented" ? segmentNote(fixture.note) : fixture.note;
      const diagnostics = {};
      const started = Date.now();
      let memories = [];
      let error = null;
      try {
        memories = await extractLocally(note, [], "quality", () => {},
          delta => Object.assign(diagnostics, delta),
          { complete, gatheringDate: fixture.date, enableCoveragePass: true,
            enableTemporalPass: true, captureRequests: true });
      } catch (reason) {
        error = String(reason instanceof Error ? reason.message : reason);
      }
      const score = scoreExtraction(fixture, memories);
      const passed = !error && score.covered === score.total && score.correctlyTyped === score.total
        && score.redundantCount === 0 && score.forbiddenMatches.length === 0 && score.wrongReview.length === 0;
      results.push({ round, id: fixture.id, mode, sourceNote: fixture.note, submittedNote: note,
        durationMs: Date.now() - started, memories, score, diagnostics, passed, error });
      console.log(`${passed ? "PASS" : "FAIL"} round=${round} ${fixture.id} ${mode} ${score.covered}/${score.total} types=${score.correctlyTyped}/${score.total}`);
    }
  }
}

await mkdir("outputs", { recursive: true });
await writeFile("outputs/split-experiment.json", JSON.stringify({ repeats, model, results }, null, 2));
console.log("Saved raw experiment telemetry");
