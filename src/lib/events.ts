import type { EventRecord, EventSeverity, EventType } from "@/lib/types";

const eventMeta: Record<EventType, { severity: EventSeverity; label: string }> = {
  CAMERA_INTERRUPTION: { severity: "REVIEW", label: "Camera interruption" },
  VIDEO_STREAM_DEGRADED: { severity: "INFO", label: "Video stream degraded" },
  WINDOW_FOCUS_LOST: { severity: "INFO", label: "Page focus lost" },
  WINDOW_FOCUS_RESTORED: { severity: "INFO", label: "Page focus restored" },
  PAGE_VISIBILITY_CHANGED: { severity: "INFO", label: "Page visibility changed" },
  FULLSCREEN_EXITED: { severity: "INFO", label: "Fullscreen exited" },
};

export function buildEvent(
  type: EventType,
  durationSeconds: number,
  signalQuality: number,
  evidence: string[],
  fixture?: { id: string; timestamp: string },
): EventRecord {
  const meta = eventMeta[type];
  const id = fixture?.id ?? globalThis.crypto.randomUUID();

  return {
    id,
    event_type: type,
    duration_seconds: Number(durationSeconds.toFixed(1)),
    severity: meta.severity,
    signal_quality: Number(Math.min(Math.max(signalQuality, 0), 1).toFixed(2)),
    evidence: evidence.length ? evidence : ["Observable event matched the signal pattern.", "Human review is recommended."],
    timestamp: fixture?.timestamp ?? new Date().toISOString(),
    model_version: "browser-only",
    algorithm_version: "browser-instrumentation-v2",
    calibration_version: "calibration-v1",
  };
}

export function describeEvent(event: EventRecord) {
  return `${eventMeta[event.event_type].label} · ${event.severity}`;
}

export function formatEventTime(timestamp: string) {
  return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`;
}

export function eventSeverityRank(severity: EventSeverity) {
  switch (severity) {
    case "HIGH_REVIEW":
      return 3;
    case "REVIEW":
      return 2;
    default:
      return 1;
  }
}
