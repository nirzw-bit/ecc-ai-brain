# ECC Operations Controller — state contract (v1.1)

## Scope
This branch contains the persistence layer and a database-only daily audit tick for the three ECC roles that cannot be scheduled in ChatGPT. It does not replace or modify the three existing enabled ChatGPT automations.

## Roles and gates
- `independent_auditor`: enabled for a daily, read-only audit of the operations metadata schema and access boundaries. It does not yet audit Railway, application routes, backups, or the complete ECC security posture.
- `reliability_24h`: BLOCKED until a separately verified archive check is recorded as PASS. No 24-hour observation has started.
- `efficiency_challenge`: BLOCKED until the reliability run completes with PASS.

## Database objects
- `private.ecc_ops_tasks`: role configuration and state.
- `private.ecc_ops_runs`: execution history and summarized outcomes.
- `private.ecc_ops_evidence`: evidence pointers and SHA-256 hashes.
- `private.ecc_ops_gates`: explicit prerequisite gate status.
- `private.ecc_ops_controller_tick()`: security-definer, database-only audit tick.
- Cron job `ecc-ops-controller-daily`: daily at 06:15 UTC (09:15 Africa/Kampala).

## Security
- All state tables are in the unexposed `private` schema with RLS enabled.
- No table SELECT grants are given to `anon` or `authenticated`.
- `service_role` has narrow table grants; never expose its key in a client, repository, workflow log, or ChatGPT message.
- The controller function is owned by postgres, uses a fixed search_path, and is not executable by `anon` or `authenticated`.
- Evidence locators must point to access-controlled artifacts. Metadata must not contain secrets or personal content.

## Execution safeguards
- The daily job runs only the database-only read audit. It makes no external HTTP calls and does not invoke health-monitor or backup-worker code.
- A partial unique index prevents two RUNNING runs for the same task.
- Reliability and Efficiency remain disabled and gated.
- No Edge Function or new secret was necessary for this database-only phase.
- This migration is applied to the existing Supabase project. Keep this file aligned with the applied migration history.
