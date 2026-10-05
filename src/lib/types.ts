export type GazeZone =
  | "TOP_LEFT"
  | "TOP"
  | "TOP_RIGHT"
  | "LEFT"
  | "CENTER"
  | "RIGHT"
  | "BOTTOM_LEFT"
  | "BOTTOM"
  | "BOTTOM_RIGHT";

export type EventSeverity = "INFO" | "REVIEW" | "HIGH_REVIEW";
export type ObservedState =
  | "visible"
  | "hidden"
  | "focused"
  | "unfocused"
  | "exited"
  | "muted"
  | "ended"
  | "frames_unavailable";

export type EventType =
  | "CAMERA_INTERRUPTION"
  | "VIDEO_STREAM_DEGRADED"
  | "WINDOW_FOCUS_LOST"
  | "WINDOW_FOCUS_RESTORED"
  | "PAGE_VISIBILITY_CHANGED"
  | "FULLSCREEN_EXITED";

export type SignalState = "good" | "degraded" | "poor" | "unavailable";

export interface SignalQuality {
  overall_quality: number;
  state: SignalState;
  face_visibility: number;
  eye_visibility: number;
  landmark_stability: number;
  lighting_quality: number;
  motion_quality: number;
  camera_distance_quality: number;
  gaze_confidence: number;
  reasons: string[];
}

export interface EventRecord {
  id: string;
  event_type: EventType;
  duration_seconds: number;
  severity: EventSeverity;
  signal_quality: number;
  evidence: string[];
  observed_state?: ObservedState;
  timestamp: string;
  model_version: string;
  algorithm_version: string;
  calibration_version?: string;
  correlation_id?: string;
}

export interface SessionSummary {
  id: string;
  status: "ready" | "monitoring" | "completed";
  duration_seconds: number;
  signal_quality_average: number;
  review_events: number;
  events: EventRecord[];
}

export interface CalibrationSample {
  point: string;
  x: number;
  y: number;
  gaze_zone: GazeZone;
}
