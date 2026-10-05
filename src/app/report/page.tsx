"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EventTimeline } from "@/components/EventTimeline";
import { ReportCard } from "@/components/ReportCard";
import { StatusPill } from "@/components/StatusPill";
import { apiRequest } from "@/lib/api";
import type { EventRecord, EventSeverity, EventType } from "@/lib/types";

interface ApiReportEvent {
  id: string;
  timestamp: string;
  event_type: EventType;
  severity: EventSeverity;
  signal_quality: number;
  duration_seconds: number;
  metadata_json: { evidence?: string[]; observed_state?: EventRecord["observed_state"] };
  model_version: string;
  algorithm_version: string;
  correlation_id: string;
}

interface SessionReport {
  session_id: string;
  status: string;
  duration: number;
  signal_quality_average: number;
  review_events: number;
  events: ApiReportEvent[];
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function toEventRecord(event: ApiReportEvent): EventRecord {
  return {
    id: event.id,
    timestamp: event.timestamp,
    event_type: event.event_type,
    severity: event.severity,
    signal_quality: event.signal_quality,
    duration_seconds: event.duration_seconds,
    evidence: event.metadata_json.evidence ?? [],
    observed_state: event.metadata_json.observed_state,
    model_version: event.model_version,
    algorithm_version: event.algorithm_version,
    correlation_id: event.correlation_id,
  };
}

export default function ReportPage() {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [noSession, setNoSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let sessionId: string | null;
    let accessToken: string | null;
    try {
      sessionId = window.sessionStorage.getItem("focusverify-session-id");
      accessToken = window.sessionStorage.getItem("focusverify-session-token");
    } catch {
      void Promise.resolve().then(() => {
        if (!active) return;
        setError("This browser has blocked session storage, so the session token cannot be read.");
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    if (!sessionId || !accessToken) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setNoSession(true);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    void apiRequest<SessionReport>(`/api/sessions/${sessionId}/report`, {}, accessToken)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Could not load the session report.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const events = report?.events.map(toEventRecord) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Persisted session report</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Observable events</h1>
        </div>
        {report && (
          <StatusPill
            label={report.review_events ? "Requires human review" : "No review signals recorded"}
            tone={report.review_events ? "review" : "neutral"}
          />
        )}
      </div>

      {loading && <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">Loading persisted session report…</p>}
      {error && <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Report unavailable: {error}</div>}
      {noSession && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">No session report in this tab</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Start a monitoring session first. Its browser-observable event metadata will appear here after it is saved by the API.
          </p>
          <Link href="/session" className="mt-5 inline-flex rounded-full bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700">
            Open session monitoring
          </Link>
        </div>
      )}
      {report && (
        <>
          <div className="mb-8 grid gap-4 md:grid-cols-4">
            <ReportCard title="Duration" value={formatDuration(report.duration)} helper="Monitoring period" />
            <ReportCard
              title="Stream availability index"
              value={report.events.length ? `${Math.round(report.signal_quality_average * 100)}%` : "N/A"}
              helper="State index at recorded events, not a visual-quality estimate"
            />
            <ReportCard title="Review groups" value={String(report.review_events)} helper="Signals for human review" />
            <ReportCard title="Recorded events" value={String(report.events.length)} helper="Browser-observable events" />
          </div>

          <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Summary</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                <li>• Session status: {report.status}.</li>
                <li>• {report.events.length} browser-observable event(s) were persisted.</li>
                <li>• {report.review_events} event group(s) are marked for human review.</li>
                <li>• No face, gaze, identity, or cheating inference is represented by this report.</li>
              </ul>
              <div className="mt-6">
                <Link href="/reviewer" className="rounded-full bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700">
                  Reviewer sign in
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold text-slate-900">Timeline</h2>
              {events.length ? (
                <EventTimeline events={events} />
              ) : (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No browser signal events were recorded in this session.</p>
              )}
            </div>
          </div>
          <p className="mt-5 break-all text-xs text-slate-500">Session ID: {report.session_id}</p>
        </>
      )}
    </main>
  );
}
