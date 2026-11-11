import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../db";
import { getChatGPTUser } from "../chatgpt-auth";
import { enqueueRegression, getRegressionRun, listRegressionRuns, RegressionRequestError } from "../regression-queue-server";
import { EXTRACTION_FIXTURES } from "../extraction-regression";

export const dynamic = "force-dynamic";
const VERSION = "2026-07-28";

const tools = [
  {
    name: "regression_queue",
    description: "Queue Afterglow's fictional Qwen extraction regression fixtures. The on-device model runs when the owner opens Afterglow in a compatible idle browser. No real contacts or gatherings are used.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        fixtureId: { type: "string", enum: EXTRACTION_FIXTURES.map(fixture => fixture.id), description: "Optional: run just one fixture; omit for all." },
        modelChoice: { type: "string", enum: ["quality", "light"], description: "Qwen 1.5B (quality, default) or 0.5B (light)." },
        coverageEnabled: { type: "boolean", description: "Enable the experimental extra coverage pass." },
        temporalEnabled: { type: "boolean", description: "Enable the experimental date-classification pass." },
      },
    },
  },
  {
    name: "regression_list",
    description: "List recent Afterglow regression jobs, statuses and aggregate scores. Queued means waiting for the owner's browser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "regression_get",
    description: "Read a regression job and full per-pass prompts, raw model replies, verification errors, and scored memories.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

function rpc(id: unknown, result: unknown) { return NextResponse.json({ jsonrpc: "2.0", id, result }); }
function rpcError(id: unknown, code: number, message: string) { return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }); }

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return rpcError(null, -32700, "Invalid JSON"); }
  const id = body?.id ?? null;
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(id, -32600, "Invalid JSON-RPC request");
  if (body.method === "server/discover") return rpc(id, { supportedVersions: [VERSION], capabilities: { tools: {} } });
  if (body.method === "tools/list") return rpc(id, { tools });
  if (body.method !== "tools/call") return rpcError(id, -32601, "Unknown method");
  const params = body.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return rpcError(id, -32602, "Missing tool parameters");
  const { name, arguments: rawArgs } = params as Record<string, unknown>;
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs as Record<string, unknown> : {};
  try {
    const db = getDb();
    let result: unknown;
    if (name === "regression_queue") result = await enqueueRegression(db, user.userId, args);
    else if (name === "regression_list") result = await listRegressionRuns(db, user.userId);
    else if (name === "regression_get") {
      if (typeof args.id !== "string" || !args.id) throw new RegressionRequestError("A regression run ID is required");
      result = await getRegressionRun(db, user.userId, args.id);
    } else return rpcError(id, -32602, "Unknown regression tool");
    return rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (error) {
    return rpc(id, { content: [{ type: "text", text: error instanceof RegressionRequestError ? error.message : "Regression tool failed" }], isError: true });
  }
}
