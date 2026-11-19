# Verification Strategy
## Required suites
- Migration syntax, ordering and clean-apply checks against local D1.
- Type checking and unit tests.
- Canonical JSON hashing, append-only versioning, supersession, owner authorization and approval validation.
- Negative approval cases: missing, expired, revoked, wrong action/target/scope/hash, replay and self-approval.
- Injection regression: untrusted retrieved content cannot change policy or invoke tools.
- Scheduler idempotency, lease expiry, retry ceiling and bounded batch tests.
- Backup export/read-back SHA-256, manifest integrity, corrupt archive rejection and isolated restore reconciliation.
- Quota guardrails and soft-failure behavior.
- API auth tests for valid owner and unauthorized callers.
- Android/desktop smoke tests when a real endpoint and owner credentials are available.

## Evidence policy
Every test reports command, environment, timestamp, result and relevant commit SHA. Mocks and local tests must be labelled as such; they do not prove Cloudflare deployment, owner identity, live Cron or real quota compliance.
