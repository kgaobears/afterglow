#!/usr/bin/env node
/**
 * Exercise Afterglow's *production* extraction pipeline against a real model
 * exposed through an OpenAI-compatible local inference server (e.g. Ollama).
 * The same prompts, parser, atomizer, audit, and optional passes run in the app.
 */
import { writeFile } from "node:fs/promises";
import process from "node:process";
import { extractLocally } from "../app/local-inference.ts";
import { EXTRACTION_FIXTURES, scoreExtraction, scoreExtractionWeighted } from "../app/extraction-regression.ts";
import { COMPLEX_EXTRACTION_FIXTURES } from "../app/complex-extraction-fixtures.ts";

const usage = `Afterglow real-model regression suite

Run a local Qwen server first, for example:
  ollama pull qwen2.5:1.5b
  ollama serve

Then run:
  npm run test:model

Options:
  --endpoint URL         OpenAI-compatible /v1 base URL (default http://127.0.0.1:11434/v1)
  --model NAME           Model identifier (default qwen2.5:1.5b)
  --fixture ID           Run one fixture instead of the full suite
  --complex              Run the separate complex suite (weighted scoring)
  --coverage             Enable the optional information-coverage pass
  --temporal             Enable the optional date-classification pass
  --output PATH          Save full per-pass prompts, responses and scores as JSON
  --json                 Print the report as JSON rather than a readable summary
  --help                 Print this help

Environment variables: AFTERGLOW_LLM_ENDPOINT, AFTERGLOW_LLM_MODEL,
AFTERGLOW_LLM_API_KEY (optional for compatible servers).

Note: Ollama's Qwen weights/runtime differ from browser WebLLM's MLC quantization.
This is a real Qwen regression, but not a substitute for final device testing.
`;

function parseArgs(args) {
  const result = {
    endpoint: process.env.AFTERGLOW_LLM_ENDPOINT || "http://127.0.0.1:11434/v1",
    model: process.env.AFTERGLOW_LLM_MODEL || "qwen2.5:1.5b",
    fixture: null, complex: false, coverage: false, temporal: false, output: null, json: false, help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") result.help = true;
    else if (arg === "--coverage") result.coverage = true;
    else if (arg === "--temporal") result.temporal = true;
    else if (arg === "--complex") result.complex = true;
    else if (arg === "--json") result.json = true;
    else if (["--endpoint", "--model", "--fixture", "--output"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${arg}`);
      result[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function createCompletion(options) {
  const base = options.endpoint.replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  // Validate the URL before processing begins, rather than silently falling
  // back to a hosted model or a different endpoint.
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("The model endpoint must use HTTP(S)");
  return async (messages, maxTokens) => {
    let response;
    try {
      response = await fetch(parsed, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.AFTERGLOW_LLM_API_KEY ? { authorization: `Bearer ${process.env.AFTERGLOW_LLM_API_KEY}` } : {}),
        },
        body: JSON.stringify({ model: options.model, messages, temperature: 0, max_tokens: maxTokens, stream: false }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      throw new Error(`Cannot reach the model at ${parsed.origin}. Start the local inference server, or set --endpoint. ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      const explanation = (await response.text()).slice(0, 300);
      throw new Error(`Model server returned HTTP ${response.status}: ${explanation}`);
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Model server response is missing choices[0].message.content");
    return content;
  };
}

function isBackendFailure(message) {
  return /^(Cannot reach the model|Model server returned HTTP|Model server response is missing)/.test(message || "");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return; }
  const suite = options.complex ? COMPLEX_EXTRACTION_FIXTURES : EXTRACTION_FIXTURES;
  const fixtures = options.fixture ? suite.filter(item => item.id === options.fixture) : suite;
  if (!fixtures.length) throw new Error(`Unknown fixture '${options.fixture}'. Available: ${suite.map(item => item.id).join(", ")}`);
  const complete = createCompletion(options);
  const results = [];
  for (const fixture of fixtures) {
    const started = Date.now();
    const progress = [];
    const diagnostics = {};
    let memories = [];
    let error;
    try {
      for (const [gatheringIndex, gathering] of (fixture.notes || [{ note: fixture.note, date: fixture.date }]).entries()) {
        const gatheringDiagnostics = {};
        const extracted = await extractLocally(gathering.note, [], "quality",
          entry => progress.push({ gatheringIndex, elapsedMs: Date.now() - started, ...entry }),
          update => Object.assign(gatheringDiagnostics, update),
          { complete, gatheringDate: gathering.date, enableCoveragePass: options.coverage,
            enableTemporalPass: options.temporal, captureRequests: true });
        memories.push(...extracted);
        if (fixture.notes) diagnostics[`gathering${gatheringIndex + 1}`] = gatheringDiagnostics;
        else Object.assign(diagnostics, gatheringDiagnostics);
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    results.push({ id: fixture.id, title: fixture.title, sourceNote: fixture.note,
      gatheringDate: fixture.date, model: options.model, backend: options.endpoint,
      coverageEnabled: options.coverage, temporalEnabled: options.temporal,
      durationMs: Date.now() - started, progress, diagnostics,
      memories, score: scoreExtraction(fixture, memories), weightedScore: scoreExtractionWeighted(fixture, memories), ...(error ? { error } : {}) });
    if (!options.json) {
      const last = results.at(-1);
      const passed = !last.error && last.score.covered === last.score.total && last.score.correctlyTyped === last.score.total && last.score.redundantCount === 0 && last.score.forbiddenMatches.length === 0 && last.score.wrongReview.length === 0;
      process.stdout.write(`${passed ? "PASS" : "FAIL"} ${fixture.id}: ${last.score.covered}/${last.score.total} facts, ${last.score.correctlyTyped}/${last.score.total} types, weighted ${last.weightedScore.total}/100 (${last.durationMs} ms)\n`);
      if (last.score.missing.length) process.stdout.write(`  Missing: ${last.score.missing.join(", ")}\n`);
      if (last.score.wrongType.length) process.stdout.write(`  Wrong type: ${last.score.wrongType.join(", ")}\n`);
      if (last.score.redundantCount) process.stdout.write(`  Redundant notes: ${last.score.redundantCount}\n`);
      if (last.score.forbiddenMatches.length) process.stdout.write(`  Forbidden claims: ${last.score.forbiddenMatches.join(", ")}\n`);
      if (last.score.wrongReview.length) process.stdout.write(`  Not marked for review: ${last.score.wrongReview.join(", ")}\n`);
      if (last.error) process.stdout.write(`  Error: ${last.error}\n`);
    }
    // If the inference backend is unavailable there is no value in trying
    // the same failed connection for every fixture.
    if (isBackendFailure(error)) break;
  }
  const passed = results.length === fixtures.length && results.every(item =>
    !item.error && item.score.covered === item.score.total && item.score.correctlyTyped === item.score.total && item.score.redundantCount === 0 && item.score.forbiddenMatches.length === 0 && item.score.wrongReview.length === 0);
  const report = { passed, generatedAt: new Date().toISOString(),
    config: { endpoint: options.endpoint, model: options.model, coverage: options.coverage, temporal: options.temporal, complex: options.complex },
    results };
  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!options.json) process.stdout.write(`Full per-pass telemetry saved to ${options.output}\n`);
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = passed ? 0 : results.some(item => isBackendFailure(item.error)) ? 2 : 1;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
