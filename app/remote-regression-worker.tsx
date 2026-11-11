"use client";

import { useEffect, useRef } from "react";
import { EXTRACTION_FIXTURES, scoreExtraction } from "./extraction-regression";
import { acquireLocalModel, releaseLocalModel } from "./local-model-activity";
import type { LocalDiagnostics, LocalProgress, ModelChoice } from "./local-inference";
import { useLocalProcessingQueue } from "./local-processing-provider";
import type { RegressionCaseResult, RegressionProgressEntry } from "./regression-telemetry";

type ClaimedJob = { id: string; token: string; modelChoice: ModelChoice; fixtureId: string | null;
  coverageEnabled: boolean; temporalEnabled: boolean };

async function postTesting<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/testing/runs", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), credentials: "same-origin" });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Regression service unavailable");
  return result;
}

// An invisible helper, mounted once at the root. It does no work unless a
// trusted remote job exists, the page is visible and gathering AI is idle.
export default function RemoteRegressionWorker() {
  const queue = useLocalProcessingQueue();
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    if (!queue.testingOptions.allowRemoteRegression) return;
    let disposed = false;
    let working = false;
    let interrupted = false;
    let active: ClaimedJob | null = null;

    const canRun = () => !disposed && document.visibilityState === "visible" && navigator.onLine !== false
      && queueRef.current.testingOptions.allowRemoteRegression && !queueRef.current.activeId
      && !queueRef.current.jobs.some(job => job.processingStatus === "queued" || job.processingStatus === "processing");

    const stopIfNeeded = () => {
      if (!active) return;
      interrupted = true;
      void import("./local-inference").then(({ cancelLocalInference }) => cancelLocalInference()).catch(() => {});
    };

    const poll = async () => {
      if (working || !canRun()) return;
      working = true;
      interrupted = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let finalized = false;
      let locked = false;
      try {
        const { hasLocalGPU, extractLocally } = await import("./local-inference");
        if (!canRun() || !await hasLocalGPU()) return;
        locked = acquireLocalModel("remote-regression");
        if (!locked) return;
        const claimed = await postTesting<{ job: ClaimedJob | null }>({ action: "claim" });
        if (!claimed.job) return;
        active = claimed.job;
        if (!canRun()) throw new Error("Regression interrupted");
        heartbeat = setInterval(() => {
          if (!active) return;
          void postTesting({ action: "heartbeat", id: active.id, token: active.token }).catch(stopIfNeeded);
        }, 20_000);
        const results: RegressionCaseResult[] = [];
        const fixtures = active.fixtureId ? EXTRACTION_FIXTURES.filter(item => item.id === active?.fixtureId) : EXTRACTION_FIXTURES;
        for (const fixture of fixtures) {
          if (interrupted || !canRun()) throw new Error("Regression interrupted");
          const started = performance.now();
          const diagnostics: LocalDiagnostics = {};
          const progress: RegressionProgressEntry[] = [];
          let memories: Awaited<ReturnType<typeof extractLocally>> = [];
          let error: string | undefined;
          try {
            memories = await extractLocally(fixture.note, [], active.modelChoice,
              (entry: LocalProgress) => progress.push({ elapsedMs: Math.round(performance.now() - started), ...entry }),
              (update: Partial<LocalDiagnostics>) => Object.assign(diagnostics, update),
              { gatheringDate: fixture.date, enableCoveragePass: active.coverageEnabled,
                enableTemporalPass: active.temporalEnabled, captureRequests: true });
          } catch (cause) {
            if (interrupted || !canRun()) throw cause;
            error = cause instanceof Error ? cause.message : String(cause);
          }
          results.push({ id: fixture.id, title: fixture.title, sourceNote: fixture.note, gatheringDate: fixture.date,
            model: active.modelChoice, coverageEnabled: active.coverageEnabled, temporalEnabled: active.temporalEnabled,
            durationMs: Math.round(performance.now() - started), progress, diagnostics, memories,
            score: scoreExtraction(fixture, memories), ...(error ? { error } : {}) });
        }
        if (interrupted || !canRun()) throw new Error("Regression interrupted");
        await postTesting({ action: "complete", id: active.id, token: active.token, results });
        finalized = true;
      } catch (error) {
        if (active) {
          try {
            if (interrupted || !canRun()) await postTesting({ action: "release", id: active.id, token: active.token });
            else await postTesting({ action: "fail", id: active.id, token: active.token,
              error: error instanceof Error ? error.message : String(error) });
          } catch { /* Stale leases are reclaimed when a browser becomes available. */ }
          finalized = true;
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        // Never let a failed or hidden tab retain exclusive access to the model.
        if (active && !finalized) {
          await postTesting({ action: "release", id: active.id, token: active.token }).catch(() => {});
        }
        active = null;
        if (locked) releaseLocalModel("remote-regression");
        working = false;
        if (!disposed) await queueRef.current.refresh().catch(() => {});
      }
    };

    const visibility = () => {
      if (document.visibilityState === "hidden") stopIfNeeded();
      else void poll();
    };
    const timer = setInterval(() => { void poll(); }, 25_000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    void poll();
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      stopIfNeeded();
    };
  }, [queue.testingOptions.allowRemoteRegression]);
  return null;
}
