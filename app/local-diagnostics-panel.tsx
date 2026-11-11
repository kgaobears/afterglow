"use client";

import type { LocalDiagnostics } from "./local-inference";

export default function LocalDiagnosticsPanel({ data }: { data: LocalDiagnostics }) {
  const excludedCount = data.decisions?.filter(item => item.status === "excluded").length ?? 0;
  return (
    <details className="ai-diagnostics">
      <summary><span>AI diagnostics</span><small>Temporary · only in this browser tab</small></summary>
      {!data.started ? <p className="diagnostic-intro">Run local AI to see the exact first-pass and verification responses here.</p> : <>
      <p className="diagnostic-intro">Inspect what the offline model actually returned. These diagnostics are not added to your Afterglow database and disappear when you reload the page.</p>
      <div className="diagnostic-stats">
        <div><span>Extracted updates</span><strong>{data.firstParsed ?? "—"}</strong></div>
        <div><span>Atomic notes</span><strong>{data.atomizedCount ?? "—"}</strong></div>
        <div><span>Coverage recovered</span><strong>{data.coverageAdded ?? "—"}</strong></div>
        <div><span>Fact-check accepted</span><strong>{data.auditParsed ?? "—"}</strong></div>
        <div><span>Time-classified</span><strong>{data.temporalParsed ?? "—"}</strong></div>
        <div><span>Verified notes</span><strong>{data.verifiedCount ?? "—"}</strong></div>
        <div><span>Needs review</span><strong>{data.reviewCount ?? "—"}</strong></div>
        <div><span>Excluded</span><strong>{data.decisions ? excludedCount : "—"}</strong></div>
      </div>
      <div className="diagnostic-passes">
        <section>
          <div className="diagnostic-pass-heading"><h4>Pass 1 · Extract updates</h4><small>Raw response</small></div>
          {data.firstError && <p className="diagnostic-error">Parsing error: {data.firstError}</p>}
          <pre>{data.firstRaw === undefined ? "Waiting for extraction…" : data.firstRaw || "(Empty model response)"}</pre>
        </section>
        <section>
          <div className="diagnostic-pass-heading"><h4>Pass 2 · Atomize notes</h4><small>Raw response</small></div>
          {data.atomizeError && <p className="diagnostic-error">Atomization fallback: {data.atomizeError}</p>}
          <pre>{data.atomizeRaw === undefined ? "Waiting for atomization…" : data.atomizeRaw || "(Empty model response)"}</pre>
        </section>
        <section>
          <div className="diagnostic-pass-heading"><h4>Pass 3 · Check information coverage</h4><small>Raw response · {data.coverageAdded ?? 0} recovered</small></div>
          {data.coverageError && <p className="diagnostic-error">Coverage fallback: {data.coverageError}</p>}
          <pre>{data.coverageRaw === undefined ? "Waiting for coverage check…" : data.coverageRaw || "(Empty model response)"}</pre>
        </section>
        <section>
          <div className="diagnostic-pass-heading"><h4>Pass 4 · Verify facts</h4><small>Raw response</small></div>
          {data.auditError && <p className="diagnostic-error">Verification error: {data.auditError}</p>}
          <pre>{data.auditRaw === undefined ? "Waiting for verification…" : data.auditRaw || "(Empty model response)"}</pre>
        </section>
        <section>
          <div className="diagnostic-pass-heading"><h4>Pass 5 · Classify and date</h4><small>Raw responses (in batches)</small></div>
          {data.temporalError && <p className="diagnostic-error">Date inference fallback: {data.temporalError}</p>}
          <pre>{data.temporalRaw === undefined ? "Waiting for time inference…" : data.temporalRaw.join("\n\n") || "(Empty model response)"}</pre>
        </section>
      </div>
      {!!data.decisions?.length && <section className="diagnostic-decisions">
        <h4>What happened to each candidate?</h4>
        <ul>{data.decisions.map((item, index) => <li key={`${index}-${item.name}`}>
          <div className="diagnostic-decision-heading"><strong>{item.name}</strong><span className={`diagnostic-status ${item.status}`}>{item.status === "verified" ? "Verified" : item.status === "review" ? (data.verifiedCount === undefined ? "Checking…" : "Needs review") : "Excluded"}</span></div>
          <p>{item.detail}</p>
          <small>{item.factType === "profile" ? "Profile fact" : "Timeline event"}{item.timeExpression ? ` · ${item.timeExpression}${item.timeStart ? ` (${item.timeStart}${item.timeEnd ? ` to ${item.timeEnd}` : ""})` : " · no certain date"}` : ""}</small>
          <blockquote>{item.quote || "(No supporting quote supplied)"}</blockquote>
          <small>{item.status === "review" && data.verifiedCount === undefined ? "Waiting for the second pass to check this candidate" : item.reason}</small>
        </li>)}</ul>
      </section>}
      </>}
    </details>
  );
}
