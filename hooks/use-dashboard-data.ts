"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Pipeline,
  Pauta,
  Appointment,
  SyncWarning,
} from "@/lib/types";
import { fetchStream } from "./fetch-stream";

// Re-exported so components import it alongside the other dashboard types
// rather than reaching into lib/types directly.
export type { SyncWarning };

export type StepKey =
  | "config"
  | "contacts"
  | "opportunities"
  | "pautas"
  | "appointments"
  | "tasks";

export type StepStatus =
  | "pending"
  | "loading"
  | "retrying"
  | "done"
  | "partial"
  | "error";

export interface StepState {
  status: StepStatus;
  count?: number;
}

export type StepMap = Record<StepKey, StepState>;

const INITIAL_STEPS: StepMap = {
  config: { status: "pending" },
  contacts: { status: "pending" },
  opportunities: { status: "pending" },
  pautas: { status: "pending" },
  appointments: { status: "pending" },
  tasks: { status: "pending" },
};

export interface DashboardData {
  contacts: Contact[];
  opportunities: Opportunity[];
  calls: Call[];
  tasks: Task[];
  appointments: Appointment[];
  pipelines: Pipeline[];
  members: string[];
  tags: string[];
  campaigns: string[];
  sources: string[];
  pautas: Pauta[];
  locationId: string;
  locationName: string;
  /** Datasets that came back incomplete or empty. Optional so a `data` frame
   *  from an older deploy (a tab left open through a release) still parses. */
  warnings?: SyncWarning[];
  meta: {
    totalContacts: number;
    totalOpportunities: number;
    fetchedAt: string;
  };
}

export function useDashboardData(params?: {
  startDate?: string;
  endDate?: string;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [progress, setProgress] = useState<string>("Iniciando sincronización…");
  const [locationName, setLocationName] = useState<string>("");
  const [steps, setSteps] = useState<StepMap>(INITIAL_STEPS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  // Wall-clock of the last `step` frame. A sync that stops producing steps is
  // stuck waiting on GHL, which used to look identical to a dead page — the
  // counters just froze with no explanation.
  const lastStepAtRef = useRef<number>(Date.now());

  const startDate = params?.startDate;
  const endDate = params?.endDate;

  const load = useCallback(async (sd?: string, ed?: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const searchParams = new URLSearchParams();
    if (sd) searchParams.set("startDate", sd);
    if (ed) searchParams.set("endDate", ed);
    const qs = searchParams.toString();
    const url = `/api/dashboard${qs ? `?${qs}` : ""}`;

    setIsLoading(true);
    setIsError(false);
    setProgress("Iniciando sincronización…");
    setSteps(INITIAL_STEPS);
    startedAtRef.current = Date.now();
    lastStepAtRef.current = Date.now();
    setElapsedMs(0);

    try {
      const result = await fetchStream<DashboardData>(
        url,
        setProgress,
        ctrl.signal,
        setLocationName,
        (step) => {
          lastStepAtRef.current = Date.now();
          setSteps((prev) => ({
            ...prev,
            [step.key]: { status: step.status, count: step.count },
          }));
        }
      );
      // Ignore the result of a fetch that has since been superseded (e.g. the
      // mount→abort→remount cycle from React StrictMode in dev or router.refresh
      // after login). Otherwise a stale fetch can clobber the newer one's state.
      if (ctrl.signal.aborted) return;
      setData(result);
      if (result.locationName) setLocationName(result.locationName);
      setProgress("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setIsError(true);
        setProgress("");
      }
    } finally {
      // Only the current (non-aborted) fetch may flip loading off. A superseded
      // fetch's finally must not turn off the spinner while the newer fetch is
      // still in flight — that was surfacing the empty dashboard behind the
      // loading screen.
      if (!ctrl.signal.aborted) setIsLoading(false);
    }
  }, []);

  // Load on mount and when date params change
  useEffect(() => {
    load(startDate, endDate);
    return () => {
      abortRef.current?.abort();
    };
  }, [load, startDate, endDate]);

  // Drives the elapsed-time readout and stall detection. Runs only while
  // loading, so an idle dashboard carries no timer.
  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [isLoading]);

  // No step frame in 15s. The sync is alive but waiting on GHL — the state that
  // used to render as a frozen screen with no explanation.
  const stalled = isLoading && elapsedMs > 0 && Date.now() - lastStepAtRef.current > 15_000;

  const refresh = useCallback(() => {
    load(startDate, endDate);
  }, [load, startDate, endDate]);

  return {
    data,
    isLoading,
    isError,
    progress,
    locationName,
    steps,
    elapsedMs,
    stalled,
    refresh,
  };
}
