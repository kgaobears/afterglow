"use client";

import { useEffect, useState } from "react";
import { ArrowRight, FlaskConical, LoaderCircle, Play, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { useLocalProcessingQueue } from "./local-processing-provider";
import type { LocalDiagnostics, LocalProgress, ModelChoice } from "./local-inference";
import type { TestingOption } from "./testing-options";
import { EXTRACTION_FIXTURES, scoreExtraction } from "./extraction-regression";
import { regressionFailed, type RegressionCaseResult, type RegressionProgressEntry } from "./regression-telemetry";
import RegressionLogsPanel from "./regression-logs-panel";
import { acquireLocalModel, releaseLocalModel } from "./local-model-activity";

const experiments: Array<{ key: TestingOption; title: string; detail: string; tag?: string }> = [
  {
    key: "reconsiderRejected",
    title: "Reconsider rejected facts",
    detail: "When you reprocess a gathering, previously rejected suggestions can appear in Review again. Confirmed memories stay protected.",
    tag: "Next reprocess",
  },
  {
    key: "runCoveragePass",
    title: "Recover overlooked facts",
    detail: "Compare atomic memories against the original gathering note in another on-device AI pass. Missing details become separate suggestions for review.",
    tag: "Next processing run",
  },
  {
    key: "runTemporalPass",
    title: "Final pass: classify and date",
    detail: "Use the extra on-device AI pass to distinguish profile facts from timeline events and infer tentative dates or ranges.",
    tag: "Next processing run",
  },
  {
    key: "showDiagnostics",
    title: "Show detailed AI diagnostics",
    detail: "Keep raw extraction, atomization, verification and date-pass responses available inside each gathering while testing.",
  },
  {
    key: "showTimeHints",
    title: "Show inferred date annotations",
    detail: "Display approximate dates and original time phrases beneath facts in Review, Gatherings, and contact profiles.",
  },
  {
    key: "allowRemoteRegression",
    title: "Run queued test jobs on this device",
    detail: "When Afterglow is open, visible and idle, run fictional regression fixtures submitted through its private testing API. Turn off to stop accepting new test jobs.",
  },
];

type RemoteRun = { id: string; status: string; requestedAt: number; modelChoice: string;
  fixtureId: string | null; summary: { passed: boolean; covered: number; total: number; correctlyTyped: number } | null; error: string };

export default function TestingSettingsPage() {
  const queue = useLocalProcessingQueue();
  const active = Object.values(queue.testingOptions).filter(Boolean).length;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<RegressionCaseResult[]>([]);
  const [testError, setTestError] = useState("");
  const [remoteRuns, setRemoteRuns] = useState<RemoteRun[]>([]);
  const [remoteError, setRemoteError] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [remoteDetails, setRemoteDetails] = useState<Record<string, { report: { results: RegressionCaseResult[] } | null }>>({});

  async function refreshRemoteRuns() {
    try {
      const response = await fetch("/api/testing/runs", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { runs: RemoteRun[] };
      setRemoteRuns(data.runs);
      setRemoteError("");
    } catch { /* The remote queue remains optional when offline. */ }
  }
  useEffect(() => {
    void refreshRemoteRuns();
    const timer = window.setInterval(() => { void refreshRemoteRuns(); }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function queueRemoteRun() {
    setRemoteBusy(true);
    setRemoteError("");
    try {
      const response = await fetch("/api/testing/runs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue", modelChoice: queue.modelChoice,
          coverageEnabled: queue.testingOptions.runCoveragePass, temporalEnabled: queue.testingOptions.runTemporalPass }) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Couldn't queue the regression run");
      await refreshRemoteRuns();
    } catch (error) { setRemoteError(error instanceof Error ? error.message : String(error)); }
    finally { setRemoteBusy(false); }
  }

  async function toggleRemoteDetails(id: string) {
    if (expandedRun === id) { setExpandedRun(null); return; }
    setExpandedRun(id);
    if (remoteDetails[id]) return;
    try {
      const response = await fetch(`/api/testing/runs?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn't load the test logs");
      const data = await response.json() as { report: { results: RegressionCaseResult[] } | null };
      setRemoteDetails(previous => ({ ...previous, [id]: data }));
    } catch (error) { setRemoteError(error instanceof Error ? error.message : String(error)); }
  }
  async function runRegressionSuite() {
    if (running || !queue.paused || queue.activeId) return;
    if (!acquireLocalModel("manual-regression")) { setTestError("Another on-device model task is running. Try again when it finishes."); return; }
    setRunning(true);
    setResults([]);
    setTestError("");
    try {
      const { hasLocalGPU, extractLocally } = await import("./local-inference");
      if (!await hasLocalGPU()) throw new Error("This browser needs WebGPU to run the actual offline model tests.");
      const collected: RegressionCaseResult[] = [];
      for (let index = 0; index < EXTRACTION_FIXTURES.length; index++) {
        const fixture = EXTRACTION_FIXTURES[index];
        setProgress(`Case ${index + 1}/${EXTRACTION_FIXTURES.length}: preparing…`);
        const started = performance.now();
        const diagnostics: LocalDiagnostics = {};
        const progressEvents: RegressionProgressEntry[] = [];
        let memories: Awaited<ReturnType<typeof extractLocally>> = [];
        let caseError: string | undefined;
        try {
          memories = await extractLocally(fixture.note, [], queue.modelChoice,
            (status: LocalProgress) => {
              progressEvents.push({ elapsedMs: Math.round(performance.now() - started), ...status });
              setProgress(`Case ${index + 1}/${EXTRACTION_FIXTURES.length}: ${status.phase}`);
            },
            (update: Partial<LocalDiagnostics>) => { Object.assign(diagnostics, update); },
            { gatheringDate: fixture.date, enableCoveragePass: queue.testingOptions.runCoveragePass, enableTemporalPass: queue.testingOptions.runTemporalPass, captureRequests: true });
        } catch (error) {
          caseError = error instanceof Error ? error.message : String(error);
        }
        collected.push({ id: fixture.id, title: fixture.title, sourceNote: fixture.note, gatheringDate: fixture.date,
          model: queue.modelChoice, coverageEnabled: queue.testingOptions.runCoveragePass, temporalEnabled: queue.testingOptions.runTemporalPass,
          durationMs: Math.round(performance.now() - started), progress: progressEvents, diagnostics: { ...diagnostics },
          memories, score: scoreExtraction(fixture, memories), error: caseError });
        setResults([...collected]);
      }
      setProgress("Regression run complete.");
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      releaseLocalModel("manual-regression");
    }
  }
  return <div className="testing-settings-page">
    <div className="section-heading">
      <div><div className="eyebrow">MAKE IT YOUR OWN</div><h1>Settings</h1><p>Experiment with Afterglow's local AI, then keep what works.</p></div>
      <span className="settings-heading-icon"><SlidersHorizontal size={22}/></span>
    </div>

    <section className="panel testing-settings-panel">
      <div className="settings-section-heading"><div><div className="settings-section-kicker"><FlaskConical size={15}/> TESTING & EXPERIMENTS</div><h3>Feature switches</h3><p>These settings only affect this browser. Changes to processing behavior apply to the next gathering or reprocess.</p></div><span className="settings-count">{active} of {experiments.length} on</span></div>
      <div className="testing-settings-list">
        {experiments.map(item => <label className="testing-settings-row" key={item.key}>
          <span className="testing-settings-copy"><strong>{item.title}{item.tag && <em>{item.tag}</em>}</strong><small>{item.detail}</small></span>
          <span className="testing-switch"><input type="checkbox" role="switch" aria-label={item.title} checked={queue.testingOptions[item.key]} onChange={event => queue.setTestingOption(item.key, event.target.checked)}/><span aria-hidden="true"/></span>
        </label>)}
      </div>
      <div className="settings-footer"><span>Switches are saved automatically.</span><button className="settings-reset" onClick={queue.resetTestingOptions}><RotateCcw size={13}/> Restore defaults</button></div>
    </section>

    <section className="panel testing-settings-panel">
      <div className="settings-section-heading"><div><div className="settings-section-kicker"><Sparkles size={15}/> ON-DEVICE AI</div><h3>Processing</h3><p>Use the same controls available on the Gatherings page.</p></div></div>
      <div className="testing-settings-list">
        <label className="testing-settings-row">
          <span className="testing-settings-copy"><strong>Process gatherings automatically</strong><small>When enabled, Afterglow works through the queue while the browser is open and your device supports WebGPU.</small></span>
          <span className="testing-switch"><input type="checkbox" role="switch" checked={!queue.paused} onChange={event => event.target.checked ? queue.resume() : queue.pause()}/><span aria-hidden="true"/></span>
        </label>
        <div className="testing-settings-row">
          <span className="testing-settings-copy"><strong>Offline model</strong><small>Higher accuracy is the default. The smaller model may run faster but can miss nuances.</small></span>
          <select className="settings-model-select" aria-label="Offline AI model" value={queue.modelChoice} onChange={event => queue.setModelChoice(event.target.value as ModelChoice)}>
            <option value="quality">Higher accuracy · 1.5B</option>
            <option value="light">Lightweight · 0.5B</option>
          </select>
        </div>
      </div>
      {queue.activeId&&<div className="settings-current-run">A gathering is processing now. Model and pass changes apply to the next run. <ArrowRight size={14}/></div>}
      <div className="settings-privacy"><ShieldCheck size={17}/><span>The language model runs locally in your browser. No online LLM or API key is required. Your existing people, gatherings, and approved memories are never reset by these switches.</span></div>
    </section>

    <section className="panel testing-settings-panel">
      <div className="settings-section-heading"><div><div className="settings-section-kicker"><FlaskConical size={15}/> REGRESSION TESTS</div><h3>Memory extraction checks</h3><p>Run two fictional sample gatherings through the actual offline model. Each expected detail must appear in its own atomic note; a combined note cannot count twice.</p></div></div>
      <div className="settings-test-body">
        <div className="settings-test-actions"><button className="primary-btn" disabled={running||!queue.paused||Boolean(queue.activeId)} onClick={()=>void runRegressionSuite()}>{running?<LoaderCircle size={15} className="spin"/>:<Play size={15}/>} {running?"Testing locally…":"Run regression suite"}</button><span>Testing never saves contacts, gatherings or memories.</span></div>
        {!queue.paused&&<p className="settings-test-note">Pause automatic processing above before testing so both tasks don't compete for the on-device model.</p>}
        {progress&&<p role="status" className="settings-test-progress">{progress}</p>}
        {testError&&<p role="alert" className="settings-test-error">{testError}</p>}
        {results.map(result=><div className="settings-test-result" key={result.id}>
          <div className="settings-test-result-heading"><strong>{result.title}</strong><span className={!regressionFailed(result)?"settings-test-passed":"settings-test-failed"}>{result.score.covered}/{result.score.total} facts · {result.score.correctlyTyped}/{result.score.total} types</span></div>
          {result.error&&<p className="settings-regression-log-error">Processing failed: {result.error}</p>}
          {result.score.missing.length>0&&<p>Missing independent facts: {result.score.missing.join(", ")}</p>}
          {result.score.wrongType.length>0&&<p>Different classification: {result.score.wrongType.join(", ")}</p>}
          {result.score.redundantCount>0&&<p>Redundant or overlapping notes: {result.score.redundantCount}</p>}
          <details><summary>See model's individual notes ({result.memories.length})</summary><ol>{result.memories.map((memory,index)=><li key={index}><strong>{memory.name}</strong> · {memory.detail} <small>({memory.factType||"unclassified"})</small></li>)}</ol></details>
          {regressionFailed(result)&&<RegressionLogsPanel result={result}/>}
        </div>)}
        <p className="settings-test-note">Coverage uses explicit phrase patterns and one-to-one matches. It's a useful regression signal, not a full semantic judge: inspect the notes when a paraphrase is flagged.</p>
      </div>
    </section>

    <section className="panel testing-settings-panel">
      <div className="settings-section-heading"><div><div className="settings-section-kicker"><FlaskConical size={15}/> REMOTE REGRESSION QUEUE</div><h3>Queued model checks</h3><p>Authorized testing tools can queue fictional regression runs. This browser processes them when it is open, visible, WebGPU-capable and not working on your gatherings. No contact data is involved.</p></div></div>
      <div className="settings-test-body">
        <div className="settings-test-actions"><button className="outline-btn" disabled={remoteBusy} onClick={()=>void queueRemoteRun()}>{remoteBusy?<LoaderCircle size={15} className="spin"/>:<Play size={15}/>} Queue a regression run</button><span>{queue.testingOptions.allowRemoteRegression?"This device accepts queued tests while idle.":"Remote testing is turned off on this device."}</span></div>
        {remoteError&&<p className="settings-test-error" role="alert">{remoteError}</p>}
        {!remoteRuns.length&&<p className="settings-test-note">No queued tests yet.</p>}
        {remoteRuns.slice(0,8).map(run=><div className="settings-test-result" key={run.id}>
          <div className="settings-test-result-heading"><strong>{run.fixtureId||"Full regression suite"} · {new Date(run.requestedAt).toLocaleString()}</strong>
            <span className={run.status==="completed"&&run.summary?.passed?"settings-test-passed":run.status==="completed"||run.status==="failed"?"settings-test-failed":"settings-test-progress"}>{run.status==="completed"?`${run.summary?.covered??0}/${run.summary?.total??0} facts · ${run.summary?.passed?"Passed":"Failed"}`:run.status==="queued"?"Waiting for browser":run.status==="running"?"Running on device":"Run error"}</span></div>
          {run.error&&<p className="settings-test-error">{run.error}</p>}
          {run.status==="completed"&&<><button className="settings-reset" onClick={()=>void toggleRemoteDetails(run.id)}>{expandedRun===run.id?"Hide":"View"} full logs</button>
            {expandedRun===run.id&&(remoteDetails[run.id]?.report?.results||[]).map(result=><div className="settings-test-result" key={result.id}>
              <div className="settings-test-result-heading"><strong>{result.title}</strong><span className={!regressionFailed(result)?"settings-test-passed":"settings-test-failed"}>{result.score.covered}/{result.score.total} facts</span></div>
              {result.score.missing.length>0&&<p>Missing: {result.score.missing.join(", ")}</p>}
              {result.error&&<p className="settings-test-error">{result.error}</p>}
              <RegressionLogsPanel result={result}/>
            </div>)}
            {expandedRun===run.id&&!remoteDetails[run.id]&&<p className="settings-test-note">Loading logs…</p>}</>}
        </div>)}
      </div>
    </section>
  </div>;
}
