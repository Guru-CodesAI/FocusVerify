# Security

The prototype includes basic safeguards but is not production-ready.

- CORS is restricted to the configured `WEB_ORIGIN`; production tokens require an HTTPS origin.
- Pydantic rejects extra event fields, unsupported event types, oversized evidence, and invalid reviewer input.
- Request bodies are limited to 32 KiB.
- Candidate bearer tokens are scoped to one session; reviewer routes require a separate reviewer-role, expiring HMAC-signed token.
- Reviewer tokens are bound to the configured reviewer credential version; changing the reviewer password invalidates previously issued reviewer tokens.
- Frontend and API responses set content-type sniffing, clickjacking, and referrer protections; the frontend limits camera use to its own origin, and production API responses enable HSTS.
- Remote PostgreSQL connections require TLS; weaker `sslmode` query values are upgraded to `require` while `verify-ca` and `verify-full` are preserved.
- Reviewer login, session creation, and per-session event ingestion are rate-limited.
- Event severity is server-derived, event retries are idempotent, and database writes serialize rate-limit/idempotency checks.
- Review dispositions are persisted alongside an append-only audit history.
- Credentials and signing keys are configured through environment variables.
- Local Docker Compose publishes both services only on `127.0.0.1`; development credentials must not be exposed on a public/shared network.
- SQLite persists session and event metadata locally; Render uses managed PostgreSQL. Webcam frames are not accepted by the API.

## Risk posture

This remains a prototype. Browser events are candidate-controlled telemetry and cannot prove the browser actually emitted them. Before broader production use, replace the single configured reviewer account with managed identity, move bearer credentials to an appropriate secure storage/session design, add operational monitoring, and review secret rotation, deployment headers, backups, retention, and database access controls. Configure a random `AUTH_SECRET` of at least 32 characters, reviewer credentials of at least 16 characters, and an HTTPS `WEB_ORIGIN`; production requests are rejected when these minimum checks fail.
