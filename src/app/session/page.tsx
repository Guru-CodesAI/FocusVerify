"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraMonitor, type StreamHealth } from "@/components/CameraMonitor";
import { EventTimeline } from "@/components/EventTimeline";
import { SessionTimer } from "@/components/SessionTimer";
import { StatusPill } from "@/components/StatusPill";
import { apiRequest } from "@/lib/api";
import { buildEvent } from "@/lib/events";
import type { EventRecord, EventType, ObservedState } from "@/lib/types";

interface BrowserEventRecord extends EventRecord {
  observed_state: ObservedState;
}

interface SessionCreated {
  id: string;
  candidate_access_token: string;
}

interface StoredEvent {
  id: string;
  correlation_id: string;
  timestamp: string;
  severity: EventRecord["severity"];
  signal_quality: number;
  observed_state?: EventRecord["observed_state"];
}

const API_EVENTS_PATH = (sessionId: string) => `/api/sessions/${sessionId}/events`;

function getCandidateAccessToken(currentToken: string | null) {
  if (currentToken) return currentToken;
  try {
    return window.sessionStorage.getItem("focusverify-session-token");
  } catch {
    return null;
  }
}

export default function SessionPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [streamHealth, setStreamHealth] = useState<StreamHealth>("unavailable");
  const [sessionState, setSessionState] = useState<"starting" | "monitoring" | "ending" | "completed" | "error">("starting");
  const [apiError, setApiError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const initStarted = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const queuedEvents = useRef<BrowserEventRecord[]>([]);
  const pendingWrites = useRef<Promise<void>[]>([]);
  const eventWriteChain = useRef<Promise<void>>(Promise.resolve());
  const failedEvents = useRef<Map<string, BrowserEventRecord>>(new Map());
  const finishStarted = useRef(false);
  const streamHealthRef = useRef<StreamHealth>("unavailable");

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;
    void (async () => {
      try {
        const created = await apiRequest<SessionCreated>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({}),
        });
        sessionTokenRef.current = created.candidate_access_token;
        try {
          window.sessionStorage.setItem("focusverify-session-id", created.id);
          window.sessionStorage.setItem("focusverify-session-token", created.candidate_access_token);
        } catch {
          setStorageWarning("Browser storage is unavailable; the session will run, but the report link may not persist after navigation.");
        }
        await apiRequest(`/api/sessions/${created.id}/start`, { method: "POST" }, created.candidate_access_token);
        sessionIdRef.current = created.id;
        setSessionId(created.id);
        setSessionState("monitoring");
        setApiError(null);
      } catch (error) {
        setSessionState("error");
        setApiError(error instanceof Error ? error.message : "Could not start a persisted session.");
      }
    })();
  }, []);

  const sendEvent = useCallback(async (event: BrowserEventRecord, activeSessionId: string) => {
    const accessToken = getCandidateAccessToken(sessionTokenRef.current);
    if (!accessToken) {
      failedEvents.current.set(event.id, event);
      setApiError("Session access token is not available in memory or session storage; the event was not saved.");
      return;
    }
    sessionTokenRef.current = accessToken;
    const trackedWrite = eventWriteChain.current
      .then(() => apiRequest<{ event: StoredEvent }>(API_EVENTS_PATH(activeSessionId), {
        method: "POST",
        body: JSON.stringify({
          event_type: event.event_type,
          client_event_id: event.id,
          signal_quality: event.signal_quality,
          evidence: event.evidence,
          observed_state: event.observed_state,
        }),
      }, accessToken))
      .then((response) => {
        failedEvents.current.delete(event.id);
        setEvents((current) =>
          current.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  id: response.event.id,
                  correlation_id: response.event.correlation_id,
                  timestamp: response.event.timestamp,
                  severity: response.event.severity,
                  signal_quality: response.event.signal_quality,
                  observed_state: response.event.observed_state,
                }
              : item,
          ),
        );
        setApiError(null);
      })
      .catch((error: unknown) => {
        failedEvents.current.set(event.id, event);
        setApiError(error instanceof Error ? error.message : "Could not persist a browser event.");
      })
      .finally(() => {
        pendingWrites.current = pendingWrites.current.filter((write) => write !== trackedWrite);
      });
    eventWriteChain.current = trackedWrite;
    pendingWrites.current.push(trackedWrite);
    await trackedWrite;
  }, []);

  useEffect(() => {
    if (!sessionId || !queuedEvents.current.length) return;
    const pending = queuedEvents.current;
    queuedEvents.current = [];
    for (const event of pending) void sendEvent(event, sessionId);
  }, [sendEvent, sessionId]);

  const recordBrowserSignal = useCallback((type: EventType, evidence: string[], observedState: ObservedState) => {
    const quality = streamHealthRef.current === "available"
      ? 1
      : streamHealthRef.current === "degraded"
        ? 0.5
        : 0;
    const event: BrowserEventRecord = {
      ...buildEvent(type, 0, quality, evidence),
      observed_state: observedState,
    };
    failedEvents.current.set(event.id, event);
    setEvents((current) => [event, ...current]);
    const activeSessionId = sessionIdRef.current ?? sessionId;
    if (activeSessionId) {
      void sendEvent(event, activeSessionId);
    } else {
      queuedEvents.current.push(event);
    }
  }, [sendEvent, sessionId]);

  const handleStreamHealthChange = useCallback((health: StreamHealth) => {
    streamHealthRef.current = health;
    setStreamHealth(health);
  }, []);

  const finishSession = async () => {
    if (!sessionId || finishStarted.current) return;
    finishStarted.current = true;
    setApiError(null);
    try {
      for (const event of failedEvents.current.values()) {
        await sendEvent(event, sessionId);
      }
      await Promise.all([...pendingWrites.current]);
      if (failedEvents.current.size) {
        throw new Error("Some events could not be saved. Check the API and retry before completing.");
      }
      setSessionState("ending");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      while (pendingWrites.current.length) {
        await Promise.all([...pendingWrites.current]);
      }
      if (failedEvents.current.size) {
        throw new Error("An event could not be saved while stopping monitoring. Retry before completing.");
      }
      const accessToken = getCandidateAccessToken(sessionTokenRef.current);
      if (!accessToken) throw new Error("Session access token is not available.");
      await apiRequest(`/api/sessions/${sessionId}/end`, { method: "POST" }, accessToken);
      setSessionState("completed");
    } catch (error) {
      setSessionState("monitoring");
      setApiError(error instanceof Error ? error.message : "Could not complete the session.");
    } finally {
      finishStarted.current = false;
    }
  };

  const reviewCount = new Set(
    events.filter((event) => event.severity !== "INFO").map((event) => event.correlation_id ?? event.id),
  ).size;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Monitoring</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Session live</h1>
        </div>
        <div className="flex items-center gap-3">
          <SessionTimer running={sessionState === "monitoring"} />
          <StatusPill
            label={sessionState === "monitoring" ? "Monitoring" : sessionState === "completed" ? "Completed" : sessionState === "error" ? "API unavailable" : sessionState === "ending" ? "Saving events" : "Starting"}
            tone={sessionState === "monitoring" ? "good" : sessionState === "error" ? "danger" : "neutral"}
          />
        </div>
      </div>

      {apiError && (
        <div role="alert" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Session persistence issue: {apiError}
        </div>
      )}
      {storageWarning && (
        <div role="status" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {storageWarning}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <CameraMonitor
          enabled={sessionState === "monitoring"}
          onSignalEvent={recordBrowserSignal}
          onStreamHealthChange={handleStreamHealthChange}
        />

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Current status</div>
            <div className="mt-2 text-2xl font-semibold capitalize text-slate-900">{sessionState}</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Camera stream</div>
                <div className="mt-2 text-lg font-semibold capitalize text-slate-900">{streamHealth}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Review groups</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{reviewCount}</div>
              </div>
            </div>
            {sessionId && <p className="mt-3 break-all text-xs text-slate-500">Session ID: {sessionId}</p>}
            {sessionState === "monitoring" && (
              <button
                type="button"
                onClick={() => void finishSession()}
                className="mt-4 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                Finish session
              </button>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Browser-observable signals</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between"><span>Camera stream</span><span className="font-medium capitalize text-slate-900">{streamHealth}</span></div>
              <div className="flex items-center justify-between"><span>Page visibility</span><span className="font-medium text-slate-900">Tracked</span></div>
              <div className="flex items-center justify-between"><span>Window focus</span><span className="font-medium text-slate-900">Tracked</span></div>
              <div className="flex items-center justify-between"><span>Fullscreen changes</span><span className="font-medium text-slate-900">Tracked</span></div>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              No face, gaze, identity, or behavior inference is active. Camera status describes browser stream availability only.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-500">Signal collection</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Focus, visibility, fullscreen, and camera-track changes are recorded as observable events. Raw video remains in the browser and is not sent to the API.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Event timeline</h2>
          {sessionState === "completed" ? (
            <Link href="/report" className="text-sm font-medium text-slate-700 hover:text-slate-900">
              Open report →
            </Link>
          ) : (
            <span className="text-xs text-slate-500">Finish the session to open its report.</span>
          )}
        </div>
        {events.length ? (
          <EventTimeline events={events} />
        ) : (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            No browser signal events have been observed yet.
          </p>
        )}
      </div>
    </main>
  );
}
