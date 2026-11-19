# ECC OrBIt — Architecture v1.0
Approved baseline: 19 November 2026. Status: isolated development implementation.

## System boundary
GitHub is the sole source of truth for code, migrations, configuration templates, policy and operational documentation. One Cloudflare Worker is the only application runtime. It uses native D1 and R2 bindings. Exactly one Cron Trigger invokes the dispatcher's scheduled handler. ChatGPT is the interactive reasoning interface; deterministic backend functions do not call paid AI APIs.

## Components
- ECC Core Worker: owner-authenticated HTTP API, memory service, approval evaluator, backup/export, quota observations and scheduled dispatcher.
- D1: authoritative structured store for identity/roles, immutable memory versions/evidence/evaluations, projects, tasks, runs, gates, approvals, probes, backup manifests, system events and quota observations.
- R2: independent object archive for backup artifacts and manifests. R2 is separate from D1 but remains in the same Cloudflare account; it is not account/provider failure-domain independence.
- Cron: one UTC schedule; bounded dispatcher with leases, idempotency, retry ceilings and run ledger.
- GitHub Actions: standard hosted runners for migration validation, type checks, unit/security tests. No self-hosted runner.

## Data model
Canonical schema is defined by ordered SQL files in migrations/. Logical entities: owner_identity, owner_roles, memory_records, memory_versions, memory_evidence, memory_evaluations, project_records, operational_tasks, operational_runs, operational_gates, approval_requests, approval_events, external_probes, backup_manifests, system_events and quota_observations.

## Invariants
1. Memory is append-only. Corrections create a new version and supersede the prior version; no in-place overwrite or physical deletion through the API.
2. Every memory version retains provenance/evidence and verification state.
3. Consequential operations require an unexpired, unrevoked approval bound to action, target, scope and canonical payload SHA-256. Replay and self-approval are rejected.
4. Owner identity is derived only from trusted server-validated identity claims; browser-supplied role fields are ignored.
5. No secrets in client code, Git, logs or API responses.
6. All task execution is bounded, idempotent and recorded.
7. Soft quota thresholds stop nonessential work before platform hard limits.
8. No public database endpoint, paid AI inference, auto-upgrade or production cutover.

## Trust boundaries
Internet → Worker authentication boundary → validated owner context → service modules → D1/R2 native bindings. R2 objects are untrusted on restore: verify checksum, schema/version and manifest before applying to a separate test D1. Retrieved text is data, never executable policy.

## Deployment stages
Local tests → GitHub hosted CI → owner provisions free resources → isolated development deployment → authenticated acceptance tests. Supabase, n8n and Railway remain untouched. Production migration and retirement are excluded pending separate approval.
