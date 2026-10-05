# FocusVerify

FocusVerify is a privacy-aware assessment-session monitoring prototype. It records browser-observable state changes with their evidence and routes them to a human-review workflow; it does not determine whether a candidate cheated.

## Product overview

- Candidate sessions scoped by expiring access tokens
- User-triggered webcam readiness checks
- 9-point calibration flow (visual prototype only; no gaze inference is implemented)
- Browser focus, visibility, fullscreen, and camera-track monitoring
- Temporal correlation of related browser events
- Session report and reviewer workflow
- SQLite for local development and managed PostgreSQL persistence on Render for sessions, bounded event evidence, review dispositions, and an append-only audit trail
- Idempotent event ingestion, per-IP/session throttles, and bounded request bodies

## Architecture

- Frontend: Next.js + TypeScript + Tailwind CSS
- Backend: FastAPI + Pydantic
- Storage: SQLite locally; PostgreSQL in the Render deployment blueprint
- Privacy: browser-observable camera status only; raw frames are never uploaded by this prototype

## Local development

```bash
cd focusverify
npm install
npm run dev
```

Open http://localhost:3000 in the browser.
Set `NEXT_PUBLIC_API_BASE_URL` in `.env.local` if the API is not at `http://localhost:8000`.

For the API (PowerShell):

```bash
cd focusverify
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

The local Docker Compose ports are also bound to `127.0.0.1`; do not expose the development reviewer defaults on a public or shared network.

## Environment variables

Copy `.env.example` to `.env.local` for the frontend and configure the same reviewer credentials, database URL, and CORS origin for the API process. The local development reviewer defaults are `reviewer@focusverify.local` / `focusverify-demo`. Never use these defaults in production.

The reviewer page at `/reviewer` lists persisted sessions after sign-in. Candidate routes require an expiring session-scoped bearer token; reviewer routes require a separate reviewer-role token. Event severity is assigned by the API, only implemented browser signals are accepted, correlated signals within five seconds share an incident group, and retries with the same event ID do not duplicate records. Camera data stays in the browser; API payload size and event evidence are bounded.

## Prototype security boundaries

Browser events are client-reported telemetry, not tamper-proof proof. A candidate can modify their own browser or call APIs with their own session token; the API prevents cross-session access and rejects unsupported face/gaze event types, but it cannot cryptographically prove that a browser event occurred. Reviewer credentials are a single environment-configured account, not production identity management. Set unique credentials and a 32-character-or-longer signing secret before production; production also requires an HTTPS `WEB_ORIGIN`. Login and session-creation throttles use the connecting IP and do not trust forwarded-IP headers.

## Testing

For a local production build in PowerShell, set the API URL before building:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000"
npm run build
```

Production builds fail if this URL is missing, malformed, or uses plain HTTP outside `localhost`/`127.0.0.1`. Docker Compose passes its API URL as a build argument; Render supplies the API service URL during the frontend build.

API tests:

```bash
pytest backend/tests/test_api.py
```

The CI workflow runs the same API tests against SQLite and an isolated PostgreSQL schema, plus frontend lint and a production build. To run its PostgreSQL integration test locally, set `FOCUSVERIFY_TEST_POSTGRES_URL` to a disposable PostgreSQL database URL; the test creates and drops a uniquely named schema.

## Privacy

See [docs/PRIVACY.md](./docs/PRIVACY.md).

## Limitations

See [docs/LIMITATIONS.md](./docs/LIMITATIONS.md).

## Deployment

This repository includes a Render Blueprint for a Next.js frontend, FastAPI API, and managed PostgreSQL database. Follow the [Render deployment guide](./docs/RENDER-DEPLOYMENT.md) to connect the repository, configure reviewer credentials, deploy, and verify the services.

The blueprint uses free web services and a paid PostgreSQL plan. Render free web services can sleep when idle; upgrade them in Render if continuous availability is required. This is suitable for a controlled internal pilot, not high-stakes or unattended proctoring. Review the [security boundaries](./docs/SECURITY.md), privacy limits, retention, backups, and reviewer identity requirements before broader use.
