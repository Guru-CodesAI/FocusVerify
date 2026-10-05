"use client";

import { useEffect, useRef, useState } from "react";
import type { EventType, ObservedState } from "@/lib/types";

export type StreamHealth = "available" | "degraded" | "unavailable";

interface CameraMonitorProps {
  enabled?: boolean;
  onSignalEvent?: (type: EventType, evidence: string[], observedState: ObservedState) => void;
  onStreamHealthChange?: (health: StreamHealth) => void;
}

export function CameraMonitor({ enabled = true, onSignalEvent, onStreamHealthChange }: CameraMonitorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "ready" | "denied">("idle");
  const [health, setHealth] = useState<StreamHealth>("unavailable");
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState("visible");
  const [focusState, setFocusState] = useState("focused");
  const focusedRef = useRef(true);
  const fullscreenRef = useRef(false);
  const healthRef = useRef<StreamHealth>("unavailable");
  const visibilityRef = useRef("visible");
  const onSignalEventRef = useRef(onSignalEvent);
  const onStreamHealthChangeRef = useRef(onStreamHealthChange);

  useEffect(() => {
    onSignalEventRef.current = onSignalEvent;
    onStreamHealthChangeRef.current = onStreamHealthChange;
  }, [onSignalEvent, onStreamHealthChange]);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let mounted = true;
    let removeTrackListeners = () => {};

    async function setupCamera() {
      if (!enabled) {
        setStream(null);
        setStatus("idle");
        setHealth("unavailable");
        healthRef.current = "unavailable";
        onStreamHealthChangeRef.current?.("unavailable");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("denied");
        setError("Camera API unavailable in this browser.");
        healthRef.current = "unavailable";
        onStreamHealthChangeRef.current?.("unavailable");
        return;
      }

      try {
        setStatus("requesting");
        activeStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
          audio: false,
        });

        if (!mounted) {
          activeStream.getTracks().forEach((track) => track.stop());
          return;
        }
        const track = activeStream.getVideoTracks()[0];
        if (!track) {
          activeStream.getTracks().forEach((activeTrack) => activeTrack.stop());
          setStream(null);
          setStatus("denied");
          setError("The browser did not provide a video track.");
          healthRef.current = "unavailable";
          onStreamHealthChangeRef.current?.("unavailable");
          return;
        }
        setStream(activeStream);
        setStatus("ready");
        setError(null);
        const handleTrackEnded = () => {
          if (!mounted) return;
          setHealth("unavailable");
          healthRef.current = "unavailable";
          onStreamHealthChangeRef.current?.("unavailable");
          onSignalEventRef.current?.("CAMERA_INTERRUPTION", ["Camera video track ended in the browser."], "ended");
        };
        const handleTrackMuted = () => {
          if (!mounted) return;
          healthRef.current = "degraded";
          setHealth("degraded");
          onStreamHealthChangeRef.current?.("degraded");
          onSignalEventRef.current?.("VIDEO_STREAM_DEGRADED", ["Browser reports the camera video track is muted."], "muted");
        };
        const handleTrackUnmuted = () => {
          if (!mounted) return;
          setError(null);
        };
        track.addEventListener("ended", handleTrackEnded);
        track.addEventListener("mute", handleTrackMuted);
        track.addEventListener("unmute", handleTrackUnmuted);
        removeTrackListeners = () => {
          track.removeEventListener("ended", handleTrackEnded);
          track.removeEventListener("mute", handleTrackMuted);
          track.removeEventListener("unmute", handleTrackUnmuted);
        };
      } catch (cameraError) {
        if (!mounted) return;
        setStatus("denied");
        setHealth("unavailable");
        healthRef.current = "unavailable";
        onStreamHealthChangeRef.current?.("unavailable");
        setError(
          cameraError instanceof Error
            ? `Camera access failed: ${cameraError.message}`
            : "Camera permission is required for visual monitoring.",
        );
      }
    }

    void setupCamera();
    return () => {
      mounted = false;
      removeTrackListeners();
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [enabled]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      if (stream) {
        void videoRef.current.play().catch(() => {
          setError("Camera is connected, but browser playback needs user interaction.");
        });
      }
    }
  }, [stream]);

  useEffect(() => {
    if (!enabled) return;
    focusedRef.current = document.hasFocus();
    setFocusState(focusedRef.current ? "focused" : "page lost focus");
    setVisibility(document.visibilityState);
    visibilityRef.current = document.visibilityState;
    fullscreenRef.current = document.fullscreenElement === containerRef.current;
    if (!focusedRef.current) {
      onSignalEventRef.current?.(
        "WINDOW_FOCUS_LOST",
        ["Monitoring began while the browser window was not focused."],
        "unfocused",
      );
    }
    if (document.visibilityState !== "visible") {
      onSignalEventRef.current?.(
        "PAGE_VISIBILITY_CHANGED",
        [`Monitoring began while document visibility was ${document.visibilityState}.`],
        "hidden",
      );
    }

    const handleVisibility = () => {
      const state = document.visibilityState;
      if (visibilityRef.current === state) return;
      visibilityRef.current = state;
      const observedState: ObservedState = state === "visible" ? "visible" : "hidden";
      setVisibility(state);
      onSignalEventRef.current?.("PAGE_VISIBILITY_CHANGED", [`Document visibility changed to ${state}.`], observedState);
    };
    const handleFocus = () => {
      if (!focusedRef.current) {
        onSignalEventRef.current?.("WINDOW_FOCUS_RESTORED", ["The browser window emitted a focus event."], "focused");
      }
      focusedRef.current = true;
      setFocusState("focused");
    };
    const handleBlur = () => {
      if (!focusedRef.current) return;
      focusedRef.current = false;
      setFocusState("page lost focus");
      onSignalEventRef.current?.("WINDOW_FOCUS_LOST", ["The browser window emitted a blur event."], "unfocused");
    };
    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === containerRef.current;
      if (fullscreenRef.current && !isFullscreen) {
        onSignalEventRef.current?.("FULLSCREEN_EXITED", ["Fullscreen mode ended in the browser."], "exited");
      }
      fullscreenRef.current = isFullscreen;
    };

    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const track = stream?.getVideoTracks()[0];
      const video = videoRef.current;
      const nextHealth: StreamHealth =
        track?.readyState === "live" &&
        !track.muted &&
        video !== null &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
          ? "available"
          : track?.readyState === "live"
            ? "degraded"
            : "unavailable";

      setHealth(nextHealth);
      if (healthRef.current !== nextHealth) {
        healthRef.current = nextHealth;
        onStreamHealthChangeRef.current?.(nextHealth);
        if (nextHealth === "degraded" && !track?.muted) {
          onSignalEventRef.current?.(
            "VIDEO_STREAM_DEGRADED",
            ["Camera track is live, but browser video frames are unavailable."],
            "frames_unavailable",
          );
        }
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [enabled, stream]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else if (!document.fullscreenElement && containerRef.current) {
        await containerRef.current.requestFullscreen();
      } else if (containerRef.current) {
        setError("Another page element currently owns fullscreen mode.");
      }
    } catch {
      setError("Fullscreen could not be changed by this browser.");
    }
  }

  return (
    <div ref={containerRef} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-slate-600">
        <span>Webcam preview · processed in this browser</span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
          Camera stream: {health}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
        {status === "ready" ? (
          <video ref={videoRef} className="h-[360px] w-full object-cover" muted playsInline autoPlay />
        ) : (
          <div className="flex min-h-[360px] items-center justify-center text-center">
            <div>
              <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-full border-[6px] border-slate-300 bg-slate-200 text-3xl font-semibold text-slate-600">
                ◉
              </div>
              <div className="text-base font-medium text-slate-700">
                {status === "requesting" ? "Requesting camera access…" : "Camera preview unavailable"}
              </div>
              <div className="mt-1 text-sm text-slate-500">{error ?? "Waiting for camera permission."}</div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Visibility</div>
            <div className="mt-1 font-medium capitalize text-slate-900">{visibility}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Browser focus</div>
            <div className="mt-1 font-medium text-slate-900">{focusState}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          Toggle fullscreen
        </button>
      </div>
      {error && status === "ready" && <p className="mt-3 text-sm text-amber-700">{error}</p>}
    </div>
  );
}
