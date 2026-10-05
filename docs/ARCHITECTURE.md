# Architecture

This project follows a hybrid architecture with browser-side monitoring and a light FastAPI backend for session orchestration and persistence.

## Frontend

The Next.js frontend is responsible for:

- candidate setup and user-triggered camera permission check
- guided nine-point display preview (not a gaze calibration)
- session monitoring dashboard
- observing browser focus, visibility, fullscreen, and camera-track state
- persisted report and authenticated reviewer pages

## Backend

The FastAPI backend handles:

- session creation and lifecycle
- SQLite persistence for local development and PostgreSQL persistence on Render for sessions, event metadata, and aggregate reports
- five-second correlation of related browser signals
- report generation
- signed reviewer authentication and disposition audit history; writes are serialized to preserve idempotency and rate limits across API instances

## Privacy model

Camera frames remain in the browser and are not sent to the API. The backend receives browser-observable event metadata only. Computer-vision inference is not implemented in this build.
