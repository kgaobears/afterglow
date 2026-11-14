#!/usr/bin/env node
/** Standalone real-Qwen benchmark of Afterglow's pronoun-resolution prompt.
 * The prompt template and role questions mirror app/local-inference.ts and
 * app/pronoun-resolution.ts at the "NLP Pronoun Pre Resolution" iteration.
 * This lives separately because GitHub's app snapshot can lag the live Site.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const usage = `Pronoun resolution prompt benchmark
  node scripts/run-pronoun-prompt-benchmark.mjs [--fixture ID] [--model NAME]
    [--endpoint URL] [--output PATH] [--json]

Requires a local OpenAI-compatible model server (Ollama: qwen2.5:1.5b).
No extraction, atomization, or other model passes run here.
`;

function parseArgs(args) {
  const options = { model: "qwen2.5:1.5b", endpoint: "http://127.0.0.1:11434/v1", output: null, fixture: null, json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (["--model", "--endpoint", "--output", "--fixture"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value after ${arg}`);
      options[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function pronounQuestion(sentence, token) {
  const passive = /\b(?:was|were|is|are|been)\s+(\w+ed)\s+by\b/i.exec(sentence);
  const afterBy = passive && token.offset > sentence.toLowerCase().indexOf(" by ");
  if (passive) return afterBy
    ? { role: "agent of passive action", question: `Who performed the action of ${passive[1]}?` }
    : { role: "person affected by passive action", question: `Who was ${passive[1]}?` };
  if (/^(?:he|she|they)$/i.test(token.pronoun)) return { role: "actor", question: "Who most likely performed the action in this sentence?" };
  if (/^(?:him|her|them)$/i.test(token.pronoun)) return { role: "person affected or receiving", question: "Who most likely received or was affected by the action in this sentence?" };
  return { role: "possessor", question: "Whose person or thing is being referred to?" };
}

function targetToken(fixture) {
  const escaped = fixture.pronoun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...fixture.sentence.matchAll(new RegExp(`\\b${escaped}\\b`, "gi"))];
  const match = matches[fixture.occurrence];
  if (!match) throw new Error(`${fixture.id}: target ${fixture.pronoun} occurrence ${fixture.occurrence} not found`);
  return { pronoun: match[0], offset: match.index };
}

function makeMessages(fixture) {
  const token = targetToken(fixture);
  const { role, question } = pronounQuestion(fixture.sentence, token);
  return {
    token, role, question,
    messages: [
      { role: "system", content: "You resolve references in conversation notes using grammar, context and common sense. Briefly explain your reasoning before your final answer. If the text does not support one answer, say ambiguous. End with a separate line: Final answer: [person's name or named person's relationship, or ambiguous]. Never invent names." },
      { role: "user", content: `ORIGINAL NOTES:\n${fixture.note.slice(0, 12000)}\n\nTARGET SENTENCE:\n${fixture.sentence}\n\nTARGET PRONOUN: "${token.pronoun}" (character ${token.offset}, role: ${role})\n\n${question}\n\nBriefly explain why, then state Final answer:` },
    ],
  };
}

function parseFinalAnswer(raw) {
  const match = /(?:^|\n)\s*(?:final answer|answer)\s*:\s*([^\n.!?]+)/i.exec(raw);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

function normalize(text) {
  return (text || "").toLowerCase().replace(/[’']/g, "").replace(/\b(?:dr|mrs|mr|ms)\.?\s+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function score(fixture, answer) {
  const normalized = normalize(answer);
  if (fixture.expected === "ambiguous") return !answer || /^(ambiguous|unclear|unknown|cannot determine|not enough information|either)$/.test(normalized);
  return [fixture.expected, ...(fixture.aliases || [])].some(candidate => normalize(candidate) === normalized);
}

async function complete(endpoint, model, messages) {
  const base = endpoint.replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 220, stream: false }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  if (typeof payload?.choices?.[0]?.message?.content !== "string") throw new Error("Model response missing content");
  return payload.choices[0].message.content;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const all = JSON.parse(await readFile(new URL("../tests/fixtures/pronoun-prompt-cases.json", import.meta.url), "utf8"));
  const cases = options.fixture ? all.filter(item => item.id === options.fixture) : all;
  if (!cases.length) throw new Error(`Unknown fixture: ${options.fixture}`);
  // Fixture validation runs before any model call, making malformed cases fail fast.
  for (const fixture of cases) {
    if (!fixture.id || !fixture.note.includes(fixture.sentence) || !fixture.expected) throw new Error(`Invalid fixture: ${fixture.id}`);
    targetToken(fixture);
  }
  const results = [];
  for (const fixture of cases) {
    const prompt = makeMessages(fixture);
    const started = Date.now();
    let raw = null, answer = null, error = null;
    try {
      raw = await complete(options.endpoint, options.model, prompt.messages);
      answer = parseFinalAnswer(raw);
    } catch (err) { error = err instanceof Error ? err.message : String(err); }
    const passed = !error && score(fixture, answer);
    results.push({ id: fixture.id, category: fixture.category, expected: fixture.expected, aliases: fixture.aliases || [], passed, answer, raw, error, elapsedMs: Date.now() - started, ...prompt });
    console.log(`${passed ? "PASS" : "FAIL"} ${fixture.id}: ${answer ?? error ?? "no final answer"} (expected ${fixture.expected})`);
  }
  const passed = results.filter(result => result.passed).length;
  const report = { model: options.model, endpoint: options.endpoint, generatedAt: new Date().toISOString(), passed, total: results.length, results };
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(`Pronoun benchmark: ${passed}/${results.length} passed`);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
