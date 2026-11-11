import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const runner = fileURLToPath(new URL("../scripts/run-model-regression.mjs", import.meta.url));

test("CLI regression runner calls the shared pipeline through a model-server HTTP adapter (scripted server)", async () => {
  const atoms = [
    { name: "Kyle", detail: "Has a brother two years older than him.", factType: "profile" },
    { name: "Kyle", detail: "His brother lives in San Francisco.", factType: "profile" },
    { name: "Kyle", detail: "Visited his brother last weekend.", factType: "timeline" },
  ];
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push({ path: request.url, payload });
    const result = payload.messages[0].content.includes("You verify")
      ? JSON.stringify({ accepted: [0, 1, 2] })
      : JSON.stringify({ memories: atoms });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: result } }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", runner, "--fixture", "kyle_brother",
        "--endpoint", `http://127.0.0.1:${address.port}/v1`, "--model", "scripted-qwen", "--json"],
        { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", value => { stdout += value; });
      child.stderr.on("data", value => { stderr += value; });
      child.once("error", reject);
      child.once("close", code => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.results[0].score.covered, 2);
    assert.equal(report.results[0].diagnostics.auditParsed, 3);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(item => item.path === "/v1/chat/completions"));
    assert.ok(requests.every(item => item.payload.model === "scripted-qwen" && item.payload.temperature === 0));
    assert.match(report.results[0].diagnostics.firstRaw, /two years older/);
    assert.match(report.results[0].diagnostics.auditRaw, /accepted/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
