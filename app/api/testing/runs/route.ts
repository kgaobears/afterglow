import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { claimRegression, enqueueRegression, failRegression, finishRegression, getRegressionRun,
  heartbeatRegression, listRegressionRuns, RegressionRequestError, releaseRegression } from "../../../regression-queue-server";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const status = error instanceof RegressionRequestError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Regression request failed";
  return NextResponse.json({ error: status === 500 ? "Regression request failed" : message }, { status });
}

export async function GET(req: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) return NextResponse.json(await getRegressionRun(getDb(), user.userId, id));
    return NextResponse.json({ runs: await listRegressionRuns(getDb(), user.userId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  // Protect private cookies from cross-site requests. MCP has a separate
  // authenticated route; this endpoint only needs same-origin browser calls.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "Cross-origin testing requests are not allowed" }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Expected JSON request" }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") || "0") > 250_000) {
    return NextResponse.json({ error: "Regression report is too large" }, { status: 413 });
  }
  try {
    const body = await req.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RegressionRequestError("Invalid request");
    const db = getDb();
    const id = typeof body.id === "string" ? body.id : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (body.action === "enqueue") return NextResponse.json(await enqueueRegression(db, user.userId, body));
    if (body.action === "claim") return NextResponse.json({ job: await claimRegression(db, user.userId) });
    if (body.action === "heartbeat") return NextResponse.json(await heartbeatRegression(db, user.userId, id, token));
    if (body.action === "release") return NextResponse.json(await releaseRegression(db, user.userId, id, token));
    if (body.action === "complete") return NextResponse.json(await finishRegression(db, user.userId, id, token, body.results));
    if (body.action === "fail") return NextResponse.json(await failRegression(db, user.userId, id, token, String(body.error || "Unknown failure")));
    throw new RegressionRequestError("Unknown testing action");
  } catch (error) { return errorResponse(error); }
}
