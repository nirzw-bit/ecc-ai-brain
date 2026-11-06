# ECC Operations Controller — state contract (v1)

## Scope
This branch contains a proposed persistence layer for the three ECC roles that cannot be scheduled in ChatGPT. It does not replace the three existing ChatGPT-scheduled roles.

## Roles and gates
- `independent_auditor`: read-only; initialized READY but disabled. It must not mutate production.
- `reliability_24h`: BLOCKED until a separately recorded archive verification has outcome PASS. It then requires a complete 24-hour observation window.
- `efficiency_challenge`: BLOCKED until the reliability run finishes with PASS.

## Data model
- `private.ecc_ops_tasks`: role configuration and current state.
- `private.ecc_ops_runs`: append-oriented execution history and summarized outcomes.
- `private.ecc_ops_evidence`: evidence pointers and SHA-256 hashes; never raw personal memory or conversation contents.

## Security
- All tables are in the unexposed `private` schema.
- RLS is enabled.
- No grants are given to `anon` or `authenticated`.
- The server-side `service_role` is the only role granted table access. Never put its key in a client, repository, workflow log, or ChatGPT message.
- Evidence locators must point to access-controlled artifacts. Metadata must not contain secrets or personal content.

## Execution safeguards
- A partial unique index prevents two RUNNING runs for the same task.
- No scheduler job, Edge Function, secret, or production deployment is created by this migration.
- The SQL file is proposed only. Review it, test it in an isolated Supabase project, run security advisors, and obtain explicit production approval before applying.
- Do not run the existing health-monitor or backup-worker scripts as part of this prototype; they can touch production.

## Current gates
All tasks are disabled. Auditor is READY but disabled; reliability and efficiency are BLOCKED. This is a stored plan, not an active schedule.
