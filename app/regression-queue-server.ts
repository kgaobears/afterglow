import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { regressionRuns } from "../db/schema";
import { parseRegressionJobOptions, regressionSummary, scoreReportedRun, type RegressionJobOptions } from "./regression-job";

const LEASE_STALE_MS = 90_000;
const MAX_OUTSTANDING_RUNS = 3;
const MAX_RESULT_LENGTH = 200_000;

export class RegressionRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Db = ReturnType<typeof getDb>;

export async function enqueueRegression(db: Db, ownerId: string, args: Record<string, unknown>) {
  let options: RegressionJobOptions;
  try { options = parseRegressionJobOptions(args); }
  catch (error) { throw new RegressionRequestError(error instanceof Error ? error.message : String(error)); }
  const outstanding = await db.select({ id: regressionRuns.id }).from(regressionRuns)
    .where(and(eq(regressionRuns.ownerId, ownerId), inArray(regressionRuns.status, ["queued", "running"]))).limit(MAX_OUTSTANDING_RUNS);
  if (outstanding.length >= MAX_OUTSTANDING_RUNS) throw new RegressionRequestError("Too many pending regression runs", 429);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(regressionRuns).values({ id, ownerId, requestedAt: now, updatedAt: now, status: "queued",
    modelChoice: options.modelChoice, fixtureId: options.fixtureId,
    coverageEnabled: options.coverageEnabled, temporalEnabled: options.temporalEnabled });
  return { id, status: "queued" as const, options, message: "Waiting for Afterglow to be open in a WebGPU-capable browser" };
}

export async function listRegressionRuns(db: Db, ownerId: string) {
  const runs = await db.select({ id: regressionRuns.id, requestedAt: regressionRuns.requestedAt, updatedAt: regressionRuns.updatedAt,
    status: regressionRuns.status, modelChoice: regressionRuns.modelChoice, fixtureId: regressionRuns.fixtureId,
    coverageEnabled: regressionRuns.coverageEnabled, temporalEnabled: regressionRuns.temporalEnabled,
    resultJson: regressionRuns.resultJson, error: regressionRuns.error })
    .from(regressionRuns).where(eq(regressionRuns.ownerId, ownerId)).orderBy(desc(regressionRuns.requestedAt)).limit(15);
  return runs.map(({ resultJson, ...run }) => {
    const report = parseResult(resultJson);
    return { ...run, summary: report?.summary ?? null };
  });
}

export async function getRegressionRun(db: Db, ownerId: string, id: string) {
  const [row] = await db.select().from(regressionRuns)
    .where(and(eq(regressionRuns.ownerId, ownerId), eq(regressionRuns.id, id))).limit(1);
  if (!row) throw new RegressionRequestError("Regression run not found", 404);
  const { resultJson, processingToken: _token, ownerId: _owner, ...visible } = row;
  return { ...visible, report: parseResult(resultJson) };
}

function parseResult(json: string) {
  if (!json) return null;
  try { return JSON.parse(json) as { summary: ReturnType<typeof regressionSummary>; results: ReturnType<typeof scoreReportedRun> }; }
  catch { return null; }
}

export async function claimRegression(db: Db, ownerId: string) {
  const now = Date.now();
  const candidates = await db.select().from(regressionRuns)
    .where(and(eq(regressionRuns.ownerId, ownerId), or(eq(regressionRuns.status, "queued"),
      and(eq(regressionRuns.status, "running"), lt(regressionRuns.updatedAt, now - LEASE_STALE_MS)))))
    .orderBy(asc(regressionRuns.requestedAt)).limit(5);
  for (const candidate of candidates) {
    const token = crypto.randomUUID();
    const condition = candidate.status === "queued" ? eq(regressionRuns.status, "queued") :
      and(eq(regressionRuns.status, "running"), eq(regressionRuns.updatedAt, candidate.updatedAt));
    const acquired = await db.update(regressionRuns).set({ status: "running", processingToken: token,
      updatedAt: now, error: "" }).where(and(eq(regressionRuns.id, candidate.id),
      eq(regressionRuns.ownerId, ownerId), condition)).returning({ id: regressionRuns.id });
    if (acquired.length) return { id: candidate.id, token, modelChoice: candidate.modelChoice,
      fixtureId: candidate.fixtureId, coverageEnabled: candidate.coverageEnabled,
      temporalEnabled: candidate.temporalEnabled };
  }
  return null;
}

async function activeLease(db: Db, ownerId: string, id: string, token: string) {
  if (!id || !token) throw new RegressionRequestError("Missing regression lease");
  return and(eq(regressionRuns.id, id), eq(regressionRuns.ownerId, ownerId),
    eq(regressionRuns.status, "running"), eq(regressionRuns.processingToken, token));
}

export async function heartbeatRegression(db: Db, ownerId: string, id: string, token: string) {
  const where = await activeLease(db, ownerId, id, token);
  const changed = await db.update(regressionRuns).set({ updatedAt: Date.now() }).where(where).returning({ id: regressionRuns.id });
  if (!changed.length) throw new RegressionRequestError("Regression lease expired", 409);
  return { ok: true };
}

export async function releaseRegression(db: Db, ownerId: string, id: string, token: string) {
  const where = await activeLease(db, ownerId, id, token);
  const changed = await db.update(regressionRuns).set({ status: "queued", processingToken: null,
    updatedAt: Date.now() }).where(where).returning({ id: regressionRuns.id });
  if (!changed.length) throw new RegressionRequestError("Regression lease expired", 409);
  return { queued: true };
}

export async function finishRegression(db: Db, ownerId: string, id: string, token: string, entries: unknown) {
  const where = await activeLease(db, ownerId, id, token);
  const [run] = await db.select().from(regressionRuns).where(where).limit(1);
  if (!run) throw new RegressionRequestError("Regression lease expired", 409);
  let results: ReturnType<typeof scoreReportedRun>;
  try {
    results = scoreReportedRun({ modelChoice: run.modelChoice === "light" ? "light" : "quality",
      fixtureId: run.fixtureId, coverageEnabled: run.coverageEnabled, temporalEnabled: run.temporalEnabled }, entries);
  } catch (error) { throw new RegressionRequestError(error instanceof Error ? error.message : String(error)); }
  const summary = regressionSummary(results);
  const resultJson = JSON.stringify({ summary, results });
  if (resultJson.length > MAX_RESULT_LENGTH) throw new RegressionRequestError("Regression telemetry exceeds the storage limit", 413);
  const saved = await db.update(regressionRuns).set({ status: "completed", processingToken: null,
    updatedAt: Date.now(), resultJson }).where(where).returning({ id: regressionRuns.id });
  if (!saved.length) throw new RegressionRequestError("Regression lease expired", 409);
  return { id, status: "completed", summary };
}

export async function failRegression(db: Db, ownerId: string, id: string, token: string, error: string) {
  const where = await activeLease(db, ownerId, id, token);
  const saved = await db.update(regressionRuns).set({ status: "failed", processingToken: null,
    updatedAt: Date.now(), error: error.slice(0, 500) }).where(where).returning({ id: regressionRuns.id });
  if (!saved.length) throw new RegressionRequestError("Regression lease expired", 409);
  return { id, status: "failed" };
}
