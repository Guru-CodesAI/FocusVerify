"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalibrationGrid } from "@/components/CalibrationGrid";
import { StatusPill } from "@/components/StatusPill";
import { calibrationPoints } from "@/lib/config";

export default function CalibrationPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((current) => {
        const next = current + 1;
        if (next >= calibrationPoints.length) {
          setProgress(100);
          return current;
        }
        setProgress(Math.round((next / calibrationPoints.length) * 100));
        return next;
      });
    }, 1400);

    return () => clearInterval(timer);
  }, []);

  const point = calibrationPoints[currentIndex] ?? calibrationPoints[calibrationPoints.length - 1];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Guided preview</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Nine-point display check</h1>
        </div>
        <StatusPill label={progress >= 100 ? "Preview complete" : "Preview in progress"} tone={progress >= 100 ? "good" : "neutral"} />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm uppercase tracking-[0.2em] text-slate-500">Target sequence preview</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{progress}%</div>
          </div>
          <div className="h-3 w-56 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-slate-900 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="mb-8 flex items-center justify-center">
          <div className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-slate-400 bg-amber-100 text-4xl font-semibold text-slate-700 shadow-sm">
            {point.label}
          </div>
        </div>

        <div className="flex justify-center">
          <CalibrationGrid currentIndex={currentIndex} />
        </div>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This is a visual 9-point sequence only. The prototype does not track eye position, measure gaze, or save calibration samples.
        </div>

        <div className="mt-8 flex gap-4">
          <Link href="/session" className="rounded-full bg-slate-900 px-6 py-3 font-medium text-white hover:bg-slate-700">
            Continue to Monitoring
          </Link>
          <Link href="/setup" className="rounded-full border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 hover:border-slate-400">
            Re-check setup
          </Link>
        </div>
      </div>
    </main>
  );
}
