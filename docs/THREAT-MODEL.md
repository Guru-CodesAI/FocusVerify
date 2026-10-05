# Threat model

## Key risks

- malicious browser inputs
- malformed API requests
- oversized payloads
- authentication bypass
- authorization error
- XSS and CSRF in browser contexts

## Mitigations

- strict validation of payloads
- rate limiting and request-size policies
- secure headers and content policies
- environment-based secrets
- reviewer routes require a signed, expiring bearer token
- review actions store a current disposition and append-only audit entry

Rate limiting, request-size policy, secure deployment headers, managed reviewer identities, and retention controls are still deployment work; the prototype should not be exposed publicly without them.
