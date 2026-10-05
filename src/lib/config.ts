export const config = {
  gaze: {
    left_threshold: -0.32,
    right_threshold: 0.32,
    up_threshold: -0.25,
    down_threshold: 0.25,
    min_event_duration: 2.5,
    calibration_points: 9,
  },
  signal: {
    overall_good: 0.8,
    overall_degraded: 0.6,
    threshold: 0.72,
  },
  event: {
    cooldown_seconds: 20,
    event_grace_period: 2,
    face_loss_grace_period: 1.5,
  },
  session: {
    inference_interval_ms: 250,
    max_local_queue: 50,
  },
};

export const calibrationPoints: Array<{ label: string; x: number; y: number }> = [
  { label: "TL", x: 0.18, y: 0.18 },
  { label: "T", x: 0.5, y: 0.18 },
  { label: "TR", x: 0.82, y: 0.18 },
  { label: "L", x: 0.18, y: 0.5 },
  { label: "C", x: 0.5, y: 0.5 },
  { label: "R", x: 0.82, y: 0.5 },
  { label: "BL", x: 0.18, y: 0.82 },
  { label: "B", x: 0.5, y: 0.82 },
  { label: "BR", x: 0.82, y: 0.82 },
];
