"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { apiRequest } from "@/lib/api";
import { formatEventTime } from "@/lib/events";

interface ReviewerSession {
  id: string;
  status: string;
  created_at: string;
  candidate_id: string | null;
  assessment_id: string | null;
  signal_quality_average: number;
  duration: number;
  event_count: number;
  review_event_count: number;
}

interface ReviewerEvent {
  id: string;
  timestamp: string;
  event_type: string;
  severity: "INFO" | "REVIEW" | "HIGH_REVIEW";
  signal_quality: number;
  duration_seconds: number;
  metadata_json: { evidence?: string[]; correlated_with?: string; observed_state?: string };
  correlation_id: string;
  review: "confirmed" | "dismissed" | null;
  review_note: string | null;
  reviewed_at: string | null;
  review_history: {
    id: string;
    disposition: "confirmed" | "dismissed";
    note: string;
    reviewer_email: string;
    created_at: string;
  }[];
}

interface ReviewerSessionDetail {
  session: ReviewerSession;
  events: ReviewerEvent[];
}

export default function ReviewerPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessions, setSessions] = useState<ReviewerSession[]>([]);
  const [detail, setDetail] = useState<ReviewerSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [workingEvent, setWorkingEvent] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sessionOffset, setSessionOffset] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [nextSessionOffset, setNextSessionOffset] = useState<number | null>(null);

  const loadSessions = useCallback(async (accessToken: string, offset = sessionOffset) => {
    const result = await apiRequest<{
      sessions: ReviewerSession[];
      total: number;
      next_offset: number | null;
    }>(`/api/reviewer/sessions?limit=50&offset=${offset}`, {}, accessToken);
    setSessions(result.sessions);
    setSessionTotal(result.total);
    setNextSessionOffset(result.next_offset);
  }, [sessionOffset]);

  const loadDetail = useCallback(async (sessionId: string, accessToken: string) => {
    const result = await apiRequest<ReviewerSessionDetail>(
      `/api/reviewer/sessions/${sessionId}`,
      {},
      accessToken,
    );
    setDetail(result);
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void apiRequest<{
      sessions: ReviewerSession[];
      total: number;
      next_offset: number | null;
    }>(`/api/reviewer/sessions?limit=50&offset=${sessionOffset}`, {}, token)
      .then((result) => {
        if (!active) return;
        setSessions(result.sessions);
        setSessionTotal(result.total);
        setNextSessionOffset(result.next_offset);
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Could not load review queue.");
      });
    return () => {
      active = false;
    };
  }, [sessionOffset, token]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ access_token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(response.access_token);
      setPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Reviewer sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseSession(sessionId: string) {
    if (!token) return;
    setError(null);
    try {
      await loadDetail(sessionId, token);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load session details.");
    }
  }

  async function setDisposition(eventId: string, disposition: "confirmed" | "dismissed") {
    if (!token || !detail) return;
    setWorkingEvent(eventId);
    setError(null);
    try {
      await apiRequest(`/api/reviewer/events/${eventId}/review`, {
        method: "PUT",
        body: JSON.stringify({ disposition, note: reviewNotes[eventId] ?? "" }),
      }, token);
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      await loadDetail(detail.session.id, token);
      await loadSessions(token, sessionOffset);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save reviewer decision.");
    } finally {
      setWorkingEvent(null);
    }
  }

  function signOut() {
    setToken(null);
    setSessions([]);
    setDetail(null);
    setError(null);
    setSessionOffset(0);
    setSessionTotal(0);
    setNextSessionOffset(null);
  }

  const correlatedEventCounts = new Map<string, number>();
  for (const event of detail?.events ?? []) {
    correlatedEventCounts.set(
      event.correlation_id,
      (correlatedEventCounts.get(event.correlation_id) ?? 0) + 1,
    );
  }

  if (!token) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Reviewer access</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Sign in to review sessions</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Reviewer access is separate from candidate monitoring. Decisions are recorded with an audit history.
          </p>
          <form className="mt-6 space-y-4" onSubmit={(event) => void signIn(event)}>
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-slate-900 px-5 py-3 font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {process.env.NODE_ENV !== "production" && (
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Local demo credentials are documented in the development setup. Configure a private reviewer account before deployment.
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Authenticated reviewer</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Session review queue</h1>
        </div>
        <button onClick={signOut} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
          Sign out
        </button>
      </div>

      {error && <div role="alert" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-slate-900">Persisted sessions ({sessionTotal})</h2>
          {sessions.length ? (
            <div className="space-y-3">
              {sessions.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => void chooseSession(session.id)}
                  className={`w-full rounded-2xl border p-4 text-left ${detail?.session.id === session.id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{session.candidate_id ?? "Candidate session"}</span>
                    <StatusPill label={session.status} tone={session.status === "completed" ? "neutral" : "review"} />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{session.id}</div>
                  <div className="mt-2 text-sm text-slate-600">
                    {session.event_count} events · {session.review_event_count ?? 0} review signals
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              No persisted sessions are available yet.
            </p>
          )}
          {sessionTotal > 50 && (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                disabled={sessionOffset === 0}
                onClick={() => setSessionOffset(Math.max(0, sessionOffset - 50))}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">
                {sessionOffset + 1}–{Math.min(sessionOffset + sessions.length, sessionTotal)} of {sessionTotal}
              </span>
              <button
                type="button"
                disabled={nextSessionOffset === null}
                onClick={() => {
                  if (nextSessionOffset !== null) setSessionOffset(nextSessionOffset);
                }}
                className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-slate-900">Evidence and disposition</h2>
          {!detail ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Select a session to review its recorded events.</p>
          ) : detail.events.length ? (
            <div className="space-y-4">
              {detail.events.map((event) => (
                <article key={event.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">{event.event_type.replaceAll("_", " ")}</h3>
                    <StatusPill label={event.review ?? event.severity} tone={event.review ? "good" : event.severity === "HIGH_REVIEW" ? "danger" : "review"} />
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                    <div>Time: {formatEventTime(event.timestamp)}</div>
                    {event.duration_seconds > 0 && <div>Duration: {event.duration_seconds.toFixed(1)} sec</div>}
                    <div>
                      Client-reported camera stream: {event.signal_quality >= 0.75
                        ? "available"
                        : event.signal_quality >= 0.25
                          ? "degraded"
                          : "unavailable"}
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-slate-600">
                    {(event.metadata_json.evidence ?? []).map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                  {event.metadata_json.observed_state && (
                    <p className="mt-2 text-xs text-slate-500">
                      Browser-reported state: {event.metadata_json.observed_state.replaceAll("_", " ")}
                    </p>
                  )}
                  {(correlatedEventCounts.get(event.correlation_id) ?? 0) > 1 && (
                    <p className="mt-3 text-xs text-slate-500">Correlated with another browser signal within five seconds.</p>
                  )}
                  {event.review_note && <p className="mt-2 text-sm text-slate-600">Reviewer note: {event.review_note}</p>}
                  {event.review_history.length > 0 && (
                    <details className="mt-3 rounded-xl bg-slate-50 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700">
                        Review history ({event.review_history.length})
                      </summary>
                      <ol className="mt-3 space-y-3">
                        {event.review_history.map((entry) => (
                          <li key={entry.id} className="border-l-2 border-slate-300 pl-3 text-sm text-slate-600">
                            <div>
                              {entry.disposition === "confirmed" ? "Confirmed observation" : "Dismissed"} ·{" "}
                              {formatEventTime(entry.created_at)} · {entry.reviewer_email}
                            </div>
                            {entry.note && <p className="mt-1">{entry.note}</p>}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  <label className="mt-4 block text-sm font-medium text-slate-700">
                    Reviewer note (optional)
                    <textarea
                      value={reviewNotes[event.id] ?? ""}
                      onChange={(change) => setReviewNotes((current) => ({ ...current, [event.id]: change.target.value }))}
                      rows={2}
                      maxLength={2000}
                      className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 font-normal"
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={workingEvent === event.id}
                      onClick={() => void setDisposition(event.id, "confirmed")}
                      className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Confirm observation
                    </button>
                    <button
                      type="button"
                      disabled={workingEvent === event.id}
                      onClick={() => void setDisposition(event.id, "dismissed")}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No events were recorded in this session.</p>
          )}
        </section>
      </div>
    </main>
  );
}
