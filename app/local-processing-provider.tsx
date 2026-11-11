"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, LoaderCircle, Pause, Play, Sparkles } from "lucide-react";
import { processingCounts, type ProcessingJob } from "./processing-queue";
import { countReviewItems } from "./review-inbox-model";
import type { LocalCheckpoint, LocalDiagnostics, LocalProgress, ModelChoice } from "./local-inference";
import { DEFAULT_TESTING_OPTIONS, migratePreviousTestingOptions, parseTestingOptions, PRIOR_TESTING_OPTIONS_STORAGE_KEY, TESTING_OPTIONS_STORAGE_KEY, type TestingOption, type TestingOptions } from "./testing-options";
import { acquireLocalModel, releaseLocalModel } from "./local-model-activity";

type Context = {
  jobs: ProcessingJob[];
  reviewCount: number;
  activeId: string | null;
  progress: LocalProgress | null;
  diagnostics: (LocalDiagnostics & { gatheringId: string }) | null;
  modelChoice: ModelChoice;
  setModelChoice: (choice: ModelChoice) => void;
  testingOptions: TestingOptions;
  setTestingOption: (option: TestingOption, enabled: boolean) => void;
  resetTestingOptions: () => void;
  paused: boolean;
  supported: boolean | null;
  error: string;
  revision: number;
  refresh: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
};

const QueueContext = createContext<Context | null>(null);

export function useLocalProcessingQueue() {
  const context = useContext(QueueContext);
  if (!context) throw new Error("LocalProcessingProvider is required");
  return context;
}

async function send<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/gatherings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to update the processing queue");
  return data;
}

function readCheckpoint(raw: string): LocalCheckpoint {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as LocalCheckpoint : {};
  } catch { return {}; }
}
function isOnline() { return navigator.onLine !== false; }

export function LocalProcessingProvider({ children }: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<LocalProgress | null>(null);
  const [diagnostics, setDiagnostics] = useState<(LocalDiagnostics & { gatheringId: string }) | null>(null);
  const [modelChoice, setModelChoiceState] = useState<ModelChoice>("quality");
  const [testingOptions, setTestingOptionsState] = useState<TestingOptions>({ ...DEFAULT_TESTING_OPTIONS });
  const [paused, setPaused] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [wake, setWake] = useState(0);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const modelRef = useRef<ModelChoice>(modelChoice);
  const testingRef = useRef<TestingOptions>({ ...DEFAULT_TESTING_OPTIONS });
  const pausedRef = useRef(false);
  const mountedRef = useRef(true);
  const processingRef = useRef(false);
  const currentRef = useRef<{ id: string; token: string } | null>(null);
  const interruptedRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const response = await fetch("/api/gatherings", { cache: "no-store" });
    if (!response.ok) throw new Error("Couldn't load the processing queue");
    const result = await response.json() as { sessions: ProcessingJob[]; items: Array<{ id: string; gatheringId: string; name: string; detail: string; contactId: string | null; status: string }> };
    setJobs(result.sessions);
    setReviewCount(countReviewItems(result.items));
    setWake(value => value + 1);
  }, []);

  const cancelCurrent = useCallback(() => {
    const running = currentRef.current;
    if (!running) return;
    interruptedRef.current.add(running.token);
    void import("./local-inference").then(({ cancelLocalInference }) => cancelLocalInference()).catch(() => {});
  }, []);

  useEffect(() => {
    const storedModel = window.localStorage.getItem("afterglow-local-model");
    if (storedModel === "quality" || storedModel === "light") { modelRef.current = storedModel; setModelChoiceState(storedModel); }
    const isPaused = window.localStorage.getItem("afterglow-ai-paused") === "true";
    const currentTestingOptions = window.localStorage.getItem(TESTING_OPTIONS_STORAGE_KEY);
    const savedTestingOptions = currentTestingOptions === null
      ? migratePreviousTestingOptions(window.localStorage.getItem(PRIOR_TESTING_OPTIONS_STORAGE_KEY))
      : parseTestingOptions(currentTestingOptions);
    if (currentTestingOptions === null) window.localStorage.setItem(TESTING_OPTIONS_STORAGE_KEY, JSON.stringify(savedTestingOptions));
    testingRef.current = savedTestingOptions;
    setTestingOptionsState(savedTestingOptions);
    pausedRef.current = isPaused;
    setPaused(isPaused);
    setPreferencesReady(true);
    void refresh().catch(e => setError(String(e)));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancelCurrent();
      else void refresh().catch(e => setError(String(e)));
    };
    const onOnline = () => { void refresh().catch(e => setError(String(e))); };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) void refresh().catch(e => setError(String(e)));
    }, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onOnline);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", cancelCurrent);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onOnline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", cancelCurrent);
      cancelCurrent();
    };
  }, [cancelCurrent, refresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancelCurrent(); };
  }, [cancelCurrent]);

  useEffect(() => {
    if (!preferencesReady || paused || processingRef.current || document.visibilityState !== "visible" || navigator.onLine === false) return;
    if (!acquireLocalModel("gathering")) return;
    processingRef.current = true;
    void (async () => {
      try {
        const { hasLocalGPU, extractLocally } = await import("./local-inference");
        if (!await hasLocalGPU()) { setSupported(false); return; }
        setSupported(true);
        while (mountedRef.current && !pausedRef.current && document.visibilityState === "visible" && navigator.onLine !== false) {
          const { job } = await send<{ job: ProcessingJob | null }>({ action: "queue_claim" });
          if (!job?.processingToken) break;
          const token = job.processingToken;
          if (!mountedRef.current || pausedRef.current || document.visibilityState !== "visible" || !isOnline()) {
            await send({ action: "queue_release", id: job.id, token }).catch(() => {});
            break;
          }
          currentRef.current = { id: job.id, token };
          setActiveId(job.id);
          setProgress({ phase: "Preparing on-device model…" });
          setDiagnostics({ gatheringId: job.id, started: true });
          setError("");
          const heartbeat = window.setInterval(() => {
            void send({ action: "queue_heartbeat", id: job.id, token }).catch(() => {
              interruptedRef.current.add(token);
              cancelCurrent();
            });
          }, 20_000);
          try {
            const contactResponse = await fetch("/api/data", { cache: "no-store" });
            if (!contactResponse.ok) throw new Error("Couldn't load contact context for local AI");
            const contactData = await contactResponse.json() as { people: Array<{ name: string; context: string }> };
            if (interruptedRef.current.has(token) || pausedRef.current || document.visibilityState !== "visible") throw new Error("Processing interrupted");
            const memories = await extractLocally(job.rawText, contactData.people.map(person => ({ name: person.name, context: person.context })), modelRef.current, setProgress,
              update => setDiagnostics(current => current?.gatheringId === job.id ? { ...current, ...update } : current), {
                gatheringDate: job.date,
                enableCoveragePass: testingRef.current.runCoveragePass,
                enableTemporalPass: testingRef.current.runTemporalPass,
                checkpoint: readCheckpoint(job.processingCheckpoint),
                onCheckpoint: async (checkpoint: LocalCheckpoint, phase: string) => {
                  await send({ action: "queue_checkpoint", id: job.id, token, checkpoint, phase });
                },
              });
            if (interruptedRef.current.has(token) || pausedRef.current || document.visibilityState !== "visible") throw new Error("Processing interrupted");
            setProgress({ phase: "Saving suggested memories…" });
            await send({ action: "enrich", id: job.id, memories, processingToken: token });
            setProgress({ phase: "Memories ready to review" });
            setRevision(value => value + 1);
            window.dispatchEvent(new Event("afterglow-memories-updated"));
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            const interrupted = interruptedRef.current.has(token) || pausedRef.current || document.visibilityState !== "visible" || !isOnline();
            try {
              await send(interrupted ? { action: "queue_release", id: job.id, token } : { action: "queue_fail", id: job.id, token, error: message });
            } catch { /* An expired lease is recovered when the app is active again. */ }
            if (!interrupted) setError(message);
          } finally {
            window.clearInterval(heartbeat);
            interruptedRef.current.delete(token);
            currentRef.current = null;
            setActiveId(null);
            await refresh().catch(e => setError(String(e)));
          }
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        processingRef.current = false;
        releaseLocalModel("gathering");
      }
    })();
  }, [paused, preferencesReady, wake, refresh, cancelCurrent]);

  function setModelChoice(choice: ModelChoice) {
    modelRef.current = choice;
    setModelChoiceState(choice);
    window.localStorage.setItem("afterglow-local-model", choice);
  }
  function setTestingOption(option: TestingOption, enabled: boolean) {
    const next = { ...testingRef.current, [option]: enabled };
    testingRef.current = next;
    setTestingOptionsState(next);
    window.localStorage.setItem(TESTING_OPTIONS_STORAGE_KEY, JSON.stringify(next));
  }
  function resetTestingOptions() {
    const next = { ...DEFAULT_TESTING_OPTIONS };
    testingRef.current = next;
    setTestingOptionsState(next);
    window.localStorage.setItem(TESTING_OPTIONS_STORAGE_KEY, JSON.stringify(next));
  }
  function pause() {
    pausedRef.current = true;
    setPaused(true);
    window.localStorage.setItem("afterglow-ai-paused", "true");
    cancelCurrent();
  }
  function resume() {
    pausedRef.current = false;
    setPaused(false);
    window.localStorage.setItem("afterglow-ai-paused", "false");
    setWake(value => value + 1);
  }
  async function retry(id: string) {
    await send({ action: "queue_retry", id, reconsiderRejected: testingRef.current.reconsiderRejected });
    resume();
    await refresh();
  }

  return <QueueContext.Provider value={{ jobs, reviewCount, activeId, progress, diagnostics, modelChoice, setModelChoice, testingOptions, setTestingOption, resetTestingOptions, paused, supported, error, revision, refresh, retry, pause, resume }}>
    {children}
    <div className="global-processing-widget"><ProcessingChip/></div>
  </QueueContext.Provider>;
}

export function ProcessingChip() {
  const queue = useLocalProcessingQueue();
  const counts = processingCounts(queue.jobs);
  if (!counts.processing && !counts.queued && !counts.failed && !queue.reviewCount) return null;
  const label = queue.paused && (counts.processing || counts.queued) ? "AI paused" : queue.activeId ? "AI organizing" : counts.queued ? `${counts.queued} queued` : counts.failed ? `${counts.failed} need retry` : queue.reviewCount ? `${queue.reviewCount} to review` : "AI processing";
  return <span className="processing-chip" role="status">
    {queue.activeId ? <LoaderCircle size={13} className="spin"/> : counts.failed ? <AlertCircle size={13}/> : queue.paused ? <Pause size={13}/> : queue.reviewCount ? <Check size={13}/> : <Sparkles size={13}/>}
    {label}
  </span>;
}

export function ProcessingQueueControls() {
  const queue = useLocalProcessingQueue();
  const counts = processingCounts(queue.jobs);
  return <div className="queue-controls">
    <span className="queue-counts">{counts.processing ? "1 processing · " : ""}{counts.queued} waiting · {counts.failed} need attention</span>
    {queue.paused ? <button className="outline-btn" onClick={queue.resume}><Play size={14}/> Resume automatic processing</button> : <button className="outline-btn" onClick={queue.pause}><Pause size={14}/> Pause automatic processing</button>}
    {queue.supported === false && <span className="queue-warning"><AlertCircle size={14}/> WebGPU isn't available here. Your notes stay queued for a supported device.</span>}
    {queue.activeId && <span className="queue-active"><LoaderCircle size={14} className="spin"/> {queue.progress?.phase || "Processing on this device"}</span>}
    {!queue.activeId && counts.queued === 0 && counts.failed === 0 && <span className="queue-active"><Check size={14}/> Up to date</span>}
    {queue.error && <span className="queue-warning">{queue.error}</span>}
  </div>;
}
