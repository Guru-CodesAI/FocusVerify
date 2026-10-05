# Privacy

FocusVerify does not upload or persist raw webcam video. The current prototype only checks browser-reported camera stream availability; it does not perform face, eye, gaze, identity, or other visual inference. Session event metadata is persisted in the configured local SQLite database or deployment PostgreSQL database.

## What is processed

- browser tab visibility and window focus transitions
- fullscreen transitions within the preview panel
- camera video track readiness, mute, and termination state
- session-level event metadata, evidence text, and a coarse client-reported camera stream-state index
- reviewer account identifiers and review notes for audit purposes

## What is not stored by default

- raw webcam frames
- biometric templates
- identity recognition data
- face landmarks, gaze estimates, or face embeddings

## Retention

SQLite or PostgreSQL session data is retained until the database is deleted or an explicit retention policy is added. Configure backups and deletion procedures before deployment.

Candidate session bearer tokens are held in per-tab session storage so the report can be loaded after navigation. They expire after eight hours and only grant access to the corresponding session. This is a prototype storage choice; use an appropriately secured session design in production.

## Reviewer access

Reviewers require a configured account, and dispositions are stored with an append-only audit record. A reviewer disposition is not an automated finding.
