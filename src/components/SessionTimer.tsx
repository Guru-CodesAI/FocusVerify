"use client";

import { useEffect, useState } from "react";

export function SessionTimer({ running = true }: { running?: boolean }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSeconds((current) => current + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [running]);

  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Session</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{minutes}:{secs}</div>
    </div>
  );
}
