# Afterglow extraction regression tests

Afterglow runs a small, nondeterministic LLM locally in each visitor's browser.
It needs **three separate layers of testing**, not a fixed snapshot of model JSON:

1. **Fast pipeline tests** (`npm test` or `npm run test:regression`) check coverage, atomicity, the *real application pipeline* with scripted model responses, a simulated HTTP model server, and existing review invariants. They run in Node without downloading a model. **Passing these tests does not mean Qwen passed the fixtures.**
2. **Real-model command-line tests** (`npm run test:model`) send the fictional fixtures through the exact extraction/atomization/verification code and prompts used by the app, with an independently running Qwen model server. These tests can be run from a development terminal without opening the deployed app or depending on browser WebGPU.
3. **Browser WebLLM tests** (Settings → Regression tests) run the fixtures on the exact offline model/runtime used on the visitor's device. Pause automatic processing first, then select **Run regression suite**. Keep the browser awake until it completes. These are still required for device-specific WebGPU/Safari compatibility.

## Remote browser regression queue (no separate inference server)

The owner's private Afterglow Site exposes an authenticated API at `/api/testing/runs` and Site MCP tools `regression_queue`, `regression_list`, and `regression_get`. The Site only accepts the hard-coded fictional fixtures in `app/extraction-regression.ts`—never arbitrary notes or prompts. After a test job is queued:

1. A signed-in Afterglow browser with WebGPU polls for work every 25 seconds while visible and idle. A separate Settings switch controls this behavior (on by default).
2. A short server-side lease ensures only one tab claims a job at a time. A hidden/closed tab can release the job or let its stale lease expire.
3. The browser runs the normal `extractLocally` pipeline without writing contacts, gatherings or memories, and uploads per-pass raw responses and diagnostics.
4. The server independently recomputes the fixture scores, persists them in D1, and makes the complete run accessible through the API/MCP tools and Settings → Remote regression queue.

`queued` means **waiting for the owner's open WebGPU browser**, not that Qwen passed or failed. `completed` means the browser ran Qwen; inspect `report.summary.passed` and each individual result to see whether extraction succeeded. `failed` is a transport/runtime error. A server-side score cannot be marked passing by client-submitted scores alone.

To queue from the signed-in Site's same-origin browser, POST JSON like `{ "action": "enqueue", "modelChoice": "quality", "coverageEnabled": false, "temporalEnabled": false }` to `/api/testing/runs`. To query status, GET `/api/testing/runs`; use `?id=<run-id>` for detailed telemetry. MCP is the preferred way for ChatGPT to initiate and inspect jobs because the Site authenticates its tool calls for the owner.

## Run the actual model from a development terminal

### GitHub Actions (manual or automatic, unattended)

When this repository is hosted on GitHub, open **Actions → Real Qwen extraction regression → Run workflow**. The workflow in `.github/workflows/real-model-regression.yml` runs on a Linux CPU runner and:

1. Runs the deterministic extraction pipeline tests.
2. Installs Ollama and downloads `qwen2.5:1.5b` (no cloud LLM key needed).
3. Runs both fictional fixtures with coverage and temporal passes enabled, using the production extraction code and prompts.
4. Uploads `model-regression.json` with **all five passes' prompts, raw responses, errors and scores**, along with the Ollama server log, even when a model test fails.

The workflow supports manual runs and also automatically runs on pushes to `main` that modify extraction code, regression fixtures, the runner, or the workflow itself. Unrelated UI changes do not consume model-test minutes. If any fixture misses facts, misclassifies facts, or produces an error, the job fails and the artifact remains available for inspection for 14 days. Hosted runner CPU inference can take several minutes.

The browser WebGPU model uses different quantized weights/runtime, so CI is an unattended quality signal rather than a replacement for device testing.


This path uses a locally hosted, OpenAI-compatible inference API. For example, with [Ollama](https://ollama.com/) installed:

```sh
ollama pull qwen2.5:1.5b
# Start `ollama serve` if it isn't already running.
npm run test:model
```

Both regression fixtures must retain every independently useful fact and correctly classify each profile/timeline item. A failed fixture exits nonzero. Run a particular case, enable optional passes, or save the **full input prompts, raw model replies, errors, timings and per-pass diagnostics**:

```sh
npm run test:model -- --fixture kyle_brother --coverage --temporal --output outputs/model-regression.json
npm run test:model -- --endpoint http://127.0.0.1:11434/v1 --model qwen2.5:1.5b --json
```

For a single CI-quality gate when the model server is already available, use `npm run test:quality`. This runs the fast suite followed by the live Qwen suite; it never silently skips a missing model server.

Create the `outputs/` directory before using the example output path. This directory is ignored by Git. For another local inference server, set `AFTERGLOW_LLM_ENDPOINT` and `AFTERGLOW_LLM_MODEL` (optionally `AFTERGLOW_LLM_API_KEY`); the runner expects `/chat/completions` and nonstreaming Chat Completions JSON. No cloud model or API key is used unless you explicitly point the runner at one.

**Important equivalence limit:** Ollama's Qwen model and the app's `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` use different runtimes/quantizations. The CLI exercises *exactly the same prompts and application logic* but may generate different text than the browser. It is a real-model quality gate, not proof of WebLLM compatibility. Recording the chosen model identifier and keeping the browser test for final QA are both intentional.

When no inference server is available, `npm run test:model` exits **2**, not a false green. This is an infrastructure blocker, not an extraction regression. An available model that misses facts exits **1**; complete coverage/classification exits **0**.

## Add a regression case

When extraction loses information:

1. Rewrite the problematic source as a **fictional** example. Do not commit real conversation details.
2. Add a fixture in `app/extraction-regression.ts` with a stable ID, gathering date, raw source note, and expected atomic facts.
3. Give each expectation a short label, the correctly attributed person, one `profile`/`timeline` classification, and `signals` regexes matching the core meaning. Use loose alternatives for common paraphrases.
4. Run `npm run test:regression`, then `npm run test:model` against a running local Qwen server; finally run the browser suite on the high-accuracy and lightweight models if possible.
5. Inspect the returned notes for any false positive/negative. The regex evaluator is a **proxy**, not a semantic proof; different correct paraphrases can be flagged.

## Pass criteria

The Kyle fixture requires **two separate correctly attributed memories**: a profile fact about Kyle having a brother two years older, and a timeline event about Kyle visiting his brother last weekend. The brother's San Francisco residence is useful extra context, but optional and does not determine whether the regression passes. A reversed visit (the brother visiting Kyle) does not satisfy the timeline requirement.

- **Coverage:** each expected independent fact matches a **different** extracted memory. A compound note cannot satisfy multiple requirements by bundling their details.
- **Classification:** each matched fact has the expected profile or timeline type. Classification is reported separately from coverage.
- **Attribution:** an expectation only matches memories belonging to the correct named speaker.
- **Preservation:** raw gathering text remains intact, and failed model passes leave candidates available for manual review.

Date ranges and uncertainty have separate deterministic checks in `tests/temporal-facts.test.mjs`. Add focused cases there when temporal inference regresses.

**Important:** scripted pipeline tests check program invariants, not model quality. The real-model CLI suite and WebLLM browser suite reveal prompt/model regressions. Since model versions and device implementations can differ, compare detailed model output when a case fails instead of assuming every non-match is a genuine failure.
