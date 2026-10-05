import { describeEvent, formatEventTime } from "@/lib/events";
import type { EventRecord } from "@/lib/types";

export function EventTimeline({ events }: { events: EventRecord[] }) {
  const correlationCounts = new Map<string, number>();
  for (const event of events) {
    if (event.correlation_id) {
      correlationCounts.set(event.correlation_id, (correlationCounts.get(event.correlation_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">{describeEvent(event)}</div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600">
              {event.severity}
            </span>
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{formatEventTime(event.timestamp)}</div>
          {event.duration_seconds > 0 && (
            <div className="mt-2 text-sm text-slate-600">Duration: {event.duration_seconds.toFixed(1)} sec</div>
          )}
          {event.observed_state && (
            <div className="mt-2 text-xs text-slate-500">Browser state: {event.observed_state.replaceAll("_", " ")}</div>
          )}
          {event.correlation_id && (correlationCounts.get(event.correlation_id) ?? 0) > 1 && (
            <div className="mt-2 text-xs text-slate-500">Correlated browser-signal group</div>
          )}
          <ul className="mt-3 space-y-1 text-sm text-slate-600">
            {event.evidence.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
