import { calibrationPoints } from "@/lib/config";
import type { CalibrationSample, GazeZone } from "@/lib/types";

const zoneOrder: GazeZone[] = [
  "TOP_LEFT",
  "TOP",
  "TOP_RIGHT",
  "LEFT",
  "CENTER",
  "RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM",
  "BOTTOM_RIGHT",
];

export function determineGazeZone(x: number, y: number): GazeZone {
  if (x < 0.33) {
    if (y < 0.33) return "TOP_LEFT";
    if (y < 0.66) return "LEFT";
    return "BOTTOM_LEFT";
  }

  if (x < 0.66) {
    if (y < 0.33) return "TOP";
    if (y < 0.66) return "CENTER";
    return "BOTTOM";
  }

  if (y < 0.33) return "TOP_RIGHT";
  if (y < 0.66) return "RIGHT";
  return "BOTTOM_RIGHT";
}

export function mapCalibrationSample(samples: CalibrationSample[], target: { x: number; y: number }) {
  if (!samples.length) {
    return { x: 0.5, y: 0.5, gaze_zone: "CENTER" as GazeZone };
  }

  const nearest = samples.reduce((best, current) => {
    const distA = Math.hypot(current.x - target.x, current.y - target.y);
    const distB = Math.hypot(best.x - target.x, best.y - target.y);
    return distA < distB ? current : best;
  });

  return {
    x: nearest.x,
    y: nearest.y,
    gaze_zone: nearest.gaze_zone,
  };
}

export function buildCalibrationSamples(): CalibrationSample[] {
  return calibrationPoints.map((point) => ({
    point: point.label,
    x: point.x,
    y: point.y,
    gaze_zone: determineGazeZone(point.x, point.y),
  }));
}

export function formatGazeZone(zone: GazeZone) {
  return zone.replace(/_/g, " ");
}

export function deriveGazeLookups() {
  return zoneOrder.map((zone) => ({ zone, label: formatGazeZone(zone) }));
}
