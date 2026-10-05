import type { SignalQuality, SignalState } from "@/lib/types";
import { config } from "@/lib/config";

export function estimateSignalQuality(input: {
  faceVisibility: number;
  eyeVisibility: number;
  landmarkStability: number;
  lightingQuality: number;
  motionQuality: number;
  cameraDistanceQuality: number;
  gazeConfidence: number;
}): SignalQuality {
  const faceVisibility = clamp(input.faceVisibility, 0, 1);
  const eyeVisibility = clamp(input.eyeVisibility, 0, 1);
  const landmarkStability = clamp(input.landmarkStability, 0, 1);
  const lightingQuality = clamp(input.lightingQuality, 0, 1);
  const motionQuality = clamp(input.motionQuality, 0, 1);
  const cameraDistanceQuality = clamp(input.cameraDistanceQuality, 0, 1);
  const gazeConfidence = clamp(input.gazeConfidence, 0, 1);

  const overall_quality =
    faceVisibility * 0.2 +
    eyeVisibility * 0.2 +
    landmarkStability * 0.18 +
    lightingQuality * 0.12 +
    motionQuality * 0.12 +
    cameraDistanceQuality * 0.1 +
    gazeConfidence * 0.08;

  const reasons: string[] = [];
  if (faceVisibility < 0.65) reasons.push("Face visibility is limited.");
  if (eyeVisibility < 0.7) reasons.push("Eyes are partially obscured.");
  if (lightingQuality < 0.6) reasons.push("Lighting conditions are weaker than ideal.");
  if (motionQuality < 0.65) reasons.push("Motion quality is reduced.");
  if (gazeConfidence < 0.6) reasons.push("Gaze estimate confidence is reduced.");

  let state: SignalState = "good";
  if (overall_quality < config.signal.overall_degraded) state = "degraded";
  if (overall_quality < config.signal.threshold) state = "poor";
  if (overall_quality <= 0.15 || Number.isNaN(overall_quality)) state = "unavailable";

  return {
    overall_quality: Number(overall_quality.toFixed(2)),
    state,
    face_visibility: Number(faceVisibility.toFixed(2)),
    eye_visibility: Number(eyeVisibility.toFixed(2)),
    landmark_stability: Number(landmarkStability.toFixed(2)),
    lighting_quality: Number(lightingQuality.toFixed(2)),
    motion_quality: Number(motionQuality.toFixed(2)),
    camera_distance_quality: Number(cameraDistanceQuality.toFixed(2)),
    gaze_confidence: Number(gazeConfidence.toFixed(2)),
    reasons,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
