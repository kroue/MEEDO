"use client";

/**
 * components/print/PrintHost.tsx
 *
 * Prints a document from the page you're on.
 *
 * Printing used to load the document's own route in a hidden iframe and let
 * that page call window.print(). Every print booted a second copy of the whole
 * console inside the frame — sign-in, sidebar, and a header that reads every
 * concessionaire — and in development the first visit to a print route
 * compiled it, which reloaded the page and took the iframe with it, so the
 * first click never printed.
 *
 * Now the document renders into this page, out of sight, and a print
 * stylesheet shows only it while the dialog is open. Documents report when
 * their data is in through usePrintReadiness, so nothing prints half-loaded.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, X } from "lucide-react";

/** Set on <html> while a job is printing; globals.css hides everything else. */
const PRINTING_CLASS = "print-job-active";
const LOAD_TIMEOUT_MS = 20_000;
const FAILURE_VISIBLE_MS = 8_000;

interface PrintJob {
  id: number;
  content: ReactNode;
}

type JobState = { phase: "loading" } | { phase: "ready" } | { phase: "failed"; message: string };

interface PrintReadiness {
  ready: () => void;
  fail: (message: string) => void;
}

// ── The one active job, shared by every page ────────────────────────────────

let currentJob: PrintJob | null = null;
let nextJobId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Prints `content` — one of the documents in components/print/documents. */
export function printDocument(content: ReactNode) {
  currentJob = { id: nextJobId++, content };
  emit();
}

function endJob(id: number) {
  if (currentJob?.id !== id) return;
  currentJob = null;
  emit();
}

// ── Readiness, reported by the documents ────────────────────────────────────

const PrintReadinessContext = createContext<PrintReadiness>({ ready: () => {}, fail: () => {} });

function useReadinessHandlers(setState: Dispatch<SetStateAction<JobState>>): PrintReadiness {
  return useMemo(
    () => ({
      ready: () => setState((s) => (s.phase === "loading" ? { phase: "ready" } : s)),
      fail: (message: string) => setState((s) => (s.phase === "loading" ? { phase: "failed", message } : s)),
    }),
    [setState]
  );
}

/**
 * Called by a document on every render: ready once its data is in, or an
 * error message when it can't be printed at all.
 */
export function usePrintReadiness(ready: boolean, error: string | null) {
  const { ready: markReady, fail } = useContext(PrintReadinessContext);
  useEffect(() => {
    if (error) fail(error);
    else if (ready) markReady();
  }, [ready, error, markReady, fail]);
}

// ── In-page printing ─────────────────────────────────────────────────────────

/** Mounted once, in the app shell. */
export function PrintHost() {
  const job = useSyncExternalStore(subscribe, () => currentJob, () => null);
  if (!job) return null;
  return createPortal(<ActiveJob key={job.id} job={job} />, document.body);
}

function ActiveJob({ job }: { job: PrintJob }) {
  const [state, setState] = useState<JobState>({ phase: "loading" });
  const readiness = useReadinessHandlers(setState);

  // Give up rather than spin forever on a connection that never answers.
  useEffect(() => {
    if (state.phase !== "loading") return;
    const timer = setTimeout(
      () => readiness.fail("The document took too long to load. Check your connection and try again."),
      LOAD_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [state.phase, readiness]);

  useEffect(() => {
    if (state.phase !== "failed") return;
    const timer = setTimeout(() => endJob(job.id), FAILURE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state.phase, job.id]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const root = document.documentElement;
    root.classList.add(PRINTING_CLASS);
    const finish = () => endJob(job.id);
    window.addEventListener("afterprint", finish);
    // Two frames, so the document is laid out before the dialog snapshots it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", finish);
      root.classList.remove(PRINTING_CLASS);
    };
  }, [state.phase, job.id]);

  return (
    <>
      <div data-print-job>
        <PrintReadinessContext.Provider value={readiness}>{job.content}</PrintReadinessContext.Provider>
      </div>

      {state.phase === "loading" && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg"
        >
          <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
          <p className="text-sm font-medium text-slate-700">Preparing document to print…</p>
        </div>
      )}

      {state.phase === "failed" && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-lg"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="flex-1 text-sm text-slate-700">Couldn&apos;t print: {state.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => endJob(job.id)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

// ── A document on its own route ─────────────────────────────────────────────

/** Frame for the standalone print routes: prints once the document is ready. */
export function PrintPage({ children }: { children: ReactNode }) {
  const [state, setState] = useState<JobState>({ phase: "loading" });
  const readiness = useReadinessHandlers(setState);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [state.phase]);

  return (
    <div className="mx-auto min-h-screen max-w-[800px] bg-white p-8 print:m-0 print:min-h-0 print:p-0">
      <PrintReadinessContext.Provider value={readiness}>{children}</PrintReadinessContext.Provider>

      {state.phase === "loading" && (
        <p className="p-8 text-center text-sm font-medium text-slate-500">Loading document…</p>
      )}
      {state.phase === "failed" && (
        <p className="p-8 text-center text-sm font-medium text-red-500">{state.message}</p>
      )}
      {state.phase === "ready" && (
        <div className="mt-8 text-center print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            Print Again
          </button>
        </div>
      )}
    </div>
  );
}
