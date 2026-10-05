# API

## Health

`GET /api/health` checks configured database availability (SQLite locally or PostgreSQL on Render) and, in production, validates the minimum authentication and HTTPS-origin configuration. A failing dependency/configuration check returns `503`.

## Candidate sessions

`POST /api/sessions` creates a persisted session and returns a session-scoped bearer token. Session creation is limited per connecting IP.

Send `Authorization: Bearer <candidate_access_token>` on every `/api/sessions/{id}` request. The token grants access only to its session, expires after eight hours, and cannot be used on reviewer routes.

- `POST /api/sessions/{id}/start` transitions `created` to `monitoring`.
- `POST /api/sessions/{id}/end` completes an active session.
- `GET /api/sessions/{id}` reads session details.
- `GET /api/sessions/{id}/events` reads stored events.
- `GET /api/sessions/{id}/report` reads duration and event aggregates.

### Event ingestion

`POST /api/sessions/{id}/events` only accepts implemented browser events: `CAMERA_INTERRUPTION`, `VIDEO_STREAM_DEGRADED`, `WINDOW_FOCUS_LOST`, `WINDOW_FOCUS_RESTORED`, `PAGE_VISIBILITY_CHANGED`, and `FULLSCREEN_EXITED`.

Payload fields are `event_type`, UUID `client_event_id`, one or more bounded `evidence` strings, a required enumerated `observed_state` that must match the event type, and a coarse client-reported `signal_quality` score. The server generates event record IDs and scopes idempotency keys to the session. Event severity is assigned server-side (camera interruption is a review item; other allowed signals are informational); client-provided severity, confidence, duration, unrecognized fields, and unsupported face/gaze event types are rejected. The API does not return a confidence score because this build has no inference model. Repeating an event ID within a session returns the persisted event rather than inserting a duplicate, including when the session has reached its ingestion limit.

Request bodies are capped at 32 KiB; evidence is capped at eight strings, 240 characters each, and 1 KiB total. Event ingestion is limited to 120 events per session per hour by default.

Related focus/visibility/fullscreen observations and camera-track degradation/interruption events whose group began within the previous five seconds share a correlation ID. A later event cannot extend a correlation group indefinitely; records remain separate so reviewers can see each browser-reported transition.

## Reviewer authentication and review

`POST /api/auth/login` accepts the configured reviewer email/password and returns an eight-hour signed bearer token. Failed sign-ins are throttled per connecting IP (five attempts per 15 minutes by default).

Send `Authorization: Bearer <reviewer_access_token>` on all reviewer endpoints. Reviewer tokens cannot access candidate routes.

- `GET /api/reviewer/sessions?limit=50&offset=0` returns a bounded, paginated session queue.
- `GET /api/reviewer/sessions/{id}` returns persisted events and current review dispositions.
- `PUT /api/reviewer/events/{event_id}/review` accepts `{"disposition":"confirmed"|"dismissed","note":"..."}`.
- `GET /api/reviewer/events/{event_id}/audit` returns the append-only disposition history.

Reviewer dispositions update the current review state and append a separate audit entry. The audit table rejects updates and deletes in both SQLite and PostgreSQL. Credentials are configurable through `REVIEWER_EMAIL` and `REVIEWER_PASSWORD`; the local demo defaults are development-only and rejected in production.

## Data boundary

The API does not accept webcam frames, face landmarks, gaze estimates, or identity data. Browser event telemetry is candidate-controlled and is not cryptographic proof of browser state.
