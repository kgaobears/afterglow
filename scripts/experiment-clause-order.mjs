#!/usr/bin/env node
// Diagnostic experiment: same model and production extraction pipeline, varied note wording.
import { writeFile, mkdir } from "node:fs/promises";
import { extractLocally } from "../app/local-inference.ts";
import { EXTRACTION_FIXTURES, scoreExtraction } from "../app/extraction-regression.ts";

const baseline = EXTRACTION_FIXTURES.find(fixture => fixture.id === "temporary_states");
if (!baseline) throw new Error("Sarah regression fixture missing");

const notes = [
  ["original", baseline.note],
  ["job_reversed", "Sarah recently joined Apple after previously working at Google. She's looking for an apartment in Cupertino while temporarily staying with her parents for a few weeks."],
  ["housing_first", "Sarah is staying with her parents for a few weeks while looking for an apartment in Cupertino. She recently joined Apple after working at Google."],
  ["apple_last", "Sarah used to work at Google. She's staying with her parents for a few weeks while looking for an apartment in Cupertino. She recently joined Apple."],
  ["three_sentences", "Sarah previously worked at Google. She recently joined Apple. She is temporarily staying with her parents for a few weeks while looking for an apartment in Cupertino."],
  ["bullet_points", "Notes about Sarah:\n- Previously worked at Google.\n- Recently joined Apple.\n- Staying with her parents for a few weeks while looking for an apartment in Cupertino."],
];

const repeats = Math.max(1, Number(process.env.AFTERGLOW_EXPERIMENT_REPEATS || 5));
const endpoint = process.env.AFTERGLOW_LLM_ENDPOINT || "http://127.0.0.1:11434/v1";
const model = process.env.AFTERGLOW_LLM_MODEL || "qwen2.5:1.5b";
const results = [];

async function complete(messages, maxTokens) {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Model server HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  return payload.choices[0].message.content;
}

for (let round = 1; round <= repeats; round++) {
  // Rotate presentation order to avoid systematic model warm-up effects.
  const ordered = [...notes.slice(round - 1), ...notes.slice(0, round - 1)];
  for (const [variant, note] of ordered) {
    const diagnostics = {};
    const started = Date.now();
    let memories = [];
    let error = null;
    try {
      memories = await extractLocally(note, [], "quality", () => {},
        delta => Object.assign(diagnostics, delta),
        { complete, gatheringDate: baseline.date, enableCoveragePass: true,
          enableTemporalPass: true, captureRequests: true });
    } catch (reason) {
      error = String(reason instanceof Error ? reason.message : reason);
    }
    const score = scoreExtraction({ ...baseline, note }, memories);
    const appleRecovered = memories.some(memory => /\bapple\b/i.test(memory.detail) && /join|work|employ|job/i.test(memory.detail));
    const housingRecovered = memories.some(memory => /parent/i.test(memory.detail) && /stay|liv/i.test(memory.detail));
    const canonical = memories.map(m => m.detail.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim());
    const exactDuplicates = canonical.length - new Set(canonical).size;
    const row = { round, variant, note, durationMs: Date.now() - started,
      appleRecovered, housingRecovered, exactDuplicates,
      score, memories, diagnostics, error };
    results.push(row);
    console.log(`${variant.padEnd(16)} round=${round} apple=${appleRecovered} housing=${housingRecovered} facts=${score.covered}/${score.total} duplicates=${exactDuplicates} count=${memories.length}${error ? ` ERROR=${error}` : ""}`);
  }
}

await mkdir("outputs", { recursive: true });
await writeFile("outputs/clause-order-experiment.json", JSON.stringify({ model, endpoint, repeats, results }, null, 2));
console.log("Saved raw diagnostics to outputs/clause-order-experiment.json");
