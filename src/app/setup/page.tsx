"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { apiRequest } from "@/lib/api";

type CheckState = "checking" | "available" | "unavailable";
type CameraState = "not-tested" | "requesting" | "available" | "unavailable";

export default function SetupPage() {
  const [apiState, setApiState] = useState<CheckState>("checking");
  const [cameraState, setCameraState] = useState<CameraState>("not-tested");
  const [visibility, setVisibility] = useState("visible");
  const [focus, setFocus] = useState("checking");
  const [secureContext, setSecureContext] = useState("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<{ status: string }>("/api/health")
      .then(() => {
        if (active) setApiState("available");
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setApiState("unavailable");
        setError(requestError instanceof Error ? requestError.message : "API health check failed.");
      });
    const visible = () => setVisibility(document.visibilityState);
    const focusWindow = () => setFocus("focused");
    const blurWindow = () => setFocus("not focused");
    const startupCheck = window.setTimeout(() => {
      if (!active) return;
      setVisibility(document.visibilityState);
      setFocus(document.hasFocus() ? "focused" : "not focused");
      setSecureContext(window.isSecureContext ? "secure" : "insecure");
    }, 0);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", focusWindow);
    window.addEventListener("blur", blurWindow);
    return () => {
      active = false;
      window.clearTimeout(startupCheck);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", focusWindow);
      window.removeEventListener("blur", blurWindow);
    };
  }, []);

  async function testCameraAccess() {
    setCameraState("requesting");
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unavailable");
      setError("Camera access requires a supported browser and a secure context.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      setCameraState("available");
    } catch (cameraError) {
      setCameraState("unavailable");
      setError(cameraError instanceof Error ? cameraError.message : "Camera access was not granted.");
    }
  }

  const checks = [
    { label: "API persistence service", value: apiState },
    { label: "Secure browser context", value: secureContext },
    { label: "Camera access test", value: cameraState.replace("-", " ") },
    { label: "Page visibility", value: visibility },
    { label: "Window focus", value: focus },
  ];
  const ready = apiState === "available";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-slate-500">Candidate setup</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Assess session readiness</h1>
        </div>
        <StatusPill label={ready ? "API ready" : apiState === "unavailable" ? "API unavailable" : "Checking"} tone={ready ? "good" : apiState === "unavailable" ? "danger" : "neutral"} />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-4">
          {checks.map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className="text-sm capitalize text-slate-600">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          Camera access is optional for the browser-signal prototype. The app records whether a camera stream is available, but does not analyze its frames; no webcam video is uploaded or persisted.
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-amber-800">{error}</p>}

        <div className="mt-8 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => void testCameraAccess()}
            disabled={cameraState === "requesting"}
            className="rounded-full border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 hover:border-slate-400 disabled:opacity-60"
          >
            {cameraState === "requesting" ? "Checking camera…" : "Test camera access"}
          </button>
          <Link href="/calibration" className="rounded-full bg-slate-900 px-6 py-3 font-medium text-white hover:bg-slate-700">
            Continue to guided preview
          </Link>
          <Link href="/" className="rounded-full border border-slate-300 bg-white px-6 py-3 font-medium text-slate-700 hover:border-slate-400">
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
