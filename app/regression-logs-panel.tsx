"use client";

import { useState } from "react";
import { Check, Copy, FileWarning } from "lucide-react";
import { regressionPassLogs, type RegressionCaseResult } from "./regression-telemetry";

export default function RegressionLogsPanel({ result }: { result: RegressionCaseResult }) {
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">("ready");
  const passes = regressionPassLogs(result);
  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        case: result.title, id: result.id, sourceNote: result.sourceNote,
        gatheringDate: result.gatheringDate, model: result.model,
        coverageEnabled: result.coverageEnabled, temporalEnabled: result.temporalEnabled,
        durationMs: result.durationMs, error: result.error ?? null,
        score: result.score, progress: result.progress,
        passes, decisions: result.diagnostics.decisions ?? [],
        finalMemories: result.memories, diagnostics: result.diagnostics,
      }, null, 2));
      setCopyState("copied");
    } catch { setCopyState("failed"); }
  }
  return <details className="settings-regression-logs">
    <summary><FileWarning size={15}/> Full LLM pass logs and telemetry <span>Passes 1–5</span></summary>
    <div className="settings-regression-logs-body">
      <div className="settings-regression-log-meta">
        <span>Model: {result.model === "quality" ? "Qwen 1.5B" : "Qwen 0.5B"}</span>
        <span>Duration: {(result.durationMs / 1000).toFixed(1)}s</span>
        <span>Coverage: {result.coverageEnabled ? "on" : "off"}</span>
        <span>Date pass: {result.temporalEnabled ? "on" : "off"}</span>
        <button type="button" onClick={() => void copyLogs()}>{copyState === "copied" ? <Check size={13}/> : <Copy size={13}/>} {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy full JSON logs"}</button>
      </div>
      {result.error && <p className="settings-regression-log-error">Processing error: {result.error}</p>}
      <div className="settings-regression-log-stage-list">
        {passes.map((pass, index) => <section key={index} className="settings-regression-log-stage">
          <div className="settings-regression-log-stage-head"><strong>{pass.title}</strong><span className={`settings-regression-status ${pass.status}`}>{pass.status}</span></div>
          <small>{pass.summary}</small>
          {pass.error && <p className="settings-regression-log-error">{pass.error}</p>}
          {pass.request.length > 0 && <details className="settings-regression-log-request"><summary>View full request ({pass.request.length} {pass.request.length === 1 ? "batch" : "batches"})</summary><pre>{JSON.stringify(pass.request, null, 2)}</pre></details>}
          <pre>{pass.status === "skipped" ? "Disabled in Settings for this run." : pass.raw === null ? "This pass was not reached or did not emit a response." : pass.raw || "(Empty model response)"}</pre>
        </section>)}
      </div>
      <section className="settings-regression-log-stage"><strong>Candidate decisions and reasons</strong><pre>{JSON.stringify(result.diagnostics.decisions ?? [], null, 2)}</pre></section>
      <section className="settings-regression-log-stage"><strong>Final memories</strong><pre>{JSON.stringify(result.memories, null, 2)}</pre></section>
      <section className="settings-regression-log-stage"><strong>Processing events</strong><pre>{result.progress.map(event => `+${(event.elapsedMs / 1000).toFixed(1)}s ${event.phase}${event.fraction === undefined ? "" : ` (${Math.round(event.fraction * 100)}%)`}`).join("\n") || "No processing events captured."}</pre></section>
    </div>
  </details>;
}
