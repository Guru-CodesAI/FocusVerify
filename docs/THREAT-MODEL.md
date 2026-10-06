# Threat model

## Key risks

- malicious browser inputs
- malformed API requests
- oversized payloads
- authentication bypass
- authorization error
- XSS and CSRF in browser contexts

## Mitigations

- strict payload validation, a 32 KiB request-body cap, and bounded evidence fields
- candidate bearer tokens scoped to one session, plus signed, expiring reviewer tokens
- production health checks that reject weak authentication settings and non-HTTPS origins
- CORS restricted to the configured web origin and security response headers, including HSTS in production
- database-backed throttles for reviewer login, session creation, and per-session event ingestion
- current reviewer dispositions backed by append-only audit entries
- credentials and signing keys supplied through environment variables

## Remaining risks and deployment work

- Login and session-creation throttles key on the ASGI client's connecting address. Verify that this is the real client address behind the deployment proxy; otherwise legitimate users may share a throttle bucket. The throttles are not a distributed abuse-prevention service.
- Reviewer access is one environment-configured account, not managed identity or per-user authorization.
- Candidate session tokens are stored in per-tab browser session storage and are exposed to same-origin script execution.
- Browser events are client-controlled telemetry, not tamper-proof evidence.
- Content Security Policy, operational alerting, retention/deletion procedures, and backup/recovery practices are not fully configured by this prototype.

Use only test or approved pilot data until proxy-aware throttling, reviewer identity, monitoring, data retention, and privacy requirements have been reviewed. Do not use this prototype for automated or high-stakes decisions.
