import type { LocalDiagnostics, LocalRequestMessage, ModelChoice } from "./local-inference";
import type { ExtractionMemory, ExtractionScore } from "./extraction-regression";

export type RegressionProgressEntry = { elapsedMs: number; phase: string; fraction?: number };

export type RegressionCaseResult = {
  id: string;
  title: string;
  sourceNote: string;
  gatheringDate: string;
  model: ModelChoice;
  coverageEnabled: boolean;
  temporalEnabled: boolean;
  durationMs: number;
  progress: RegressionProgressEntry[];
  diagnostics: LocalDiagnostics;
  memories: ExtractionMemory[];
  score: ExtractionScore;
  error?: string;
};

export type RegressionPassLog = { title: string; status: "completed" | "error" | "skipped" | "not-reached"; raw: string | null; request: LocalRequestMessage[][]; error?: string; summary: string };

export function regressionFailed(result: RegressionCaseResult): boolean {
  return Boolean(result.error) || result.score.covered !== result.score.total || result.score.wrongType.length > 0 || result.score.redundantCount > 0;
}

export function regressionPassLogs(result: RegressionCaseResult): RegressionPassLog[] {
  const d = result.diagnostics;
  const pass = (title: string, raw: string | undefined, request: LocalRequestMessage[][], error: string | undefined, summary: string, enabled = true): RegressionPassLog => ({
    title,
    status: !enabled ? "skipped" : error ? "error" : raw === undefined ? "not-reached" : "completed",
    raw: raw ?? null,
    request,
    error,
    summary,
  });
  return [
    pass("Pass 1 · Extract updates", d.firstRaw, d.firstRequest ? [d.firstRequest] : [], d.firstError, `${d.firstParsed ?? "—"} parsed · ${d.firstGrounded ?? "—"} source-matched`),
    pass("Pass 2 · Atomize notes", d.atomizeRaw, d.atomizeRequest ? [d.atomizeRequest] : [], d.atomizeError, `${d.atomizeParsed ?? "—"} parsed · ${d.atomizedCount ?? "—"} candidate notes`),
    pass("Pass 3 · Check information coverage", d.coverageRaw, d.coverageRequest ? [d.coverageRequest] : [], d.coverageError, `${d.coverageParsed ?? "—"} parsed · ${d.coverageAdded ?? "—"} recovered`, result.coverageEnabled),
    pass("Pass 4 · Verify facts", d.auditRaw, d.auditRequest ? [d.auditRequest] : [], d.auditError, `${d.auditParsed ?? "—"} accepted`),
    pass("Pass 5 · Classify and date", d.temporalRaw?.join("\n\n--- Next batch ---\n\n"), d.temporalRequests || [], d.temporalError, `${d.temporalParsed ?? "—"} classified`, result.temporalEnabled),
  ];
}
