# ECC Target-Bound Approval Workflow v2 — 2026-11-06

## Deployed scope

- Supabase project: `kouvnqcdmsiyifugwesw`
- Database migration: `ecc_approval_workflow_target_bound_v2`
- Edge Function: `ecc-memory-api`, deployed version 16
- Existing legacy execution functions remain revoked.
- Supported action remains narrowly allowlisted to `memory.verify`.

## Approval model

1. The authenticated ECC owner calls `POST /approval/propose` with `action` and an exact `memory_id`.
2. The API verifies the bearer session with Supabase Auth, checks trusted `app_metadata.ecc_role=owner`, and checks the server-side owner allowlist.
3. The database assigns the proposer as `ecc-agent`; caller-supplied proposer identity is not accepted.
4. The database locks the current memory row, requires status `proposed`, records its UUID and revision, and hashes a canonical JSONB snapshot of all material memory fields.
5. The owner reviews via `POST /approval/review`. The API supplies the UUID from the verified session; the database independently checks the owner allowlist and re-computes the target hash.
6. Only the same enabled owner who reviewed the proposal may call `POST /approval/execute`. The database locks the approval and target rows, checks expiry, revision, current status, and hash, then atomically changes the memory status to `verified`, marks the approval `executed`, and writes an immutable event.

## Security properties

- Target UUID, revision and SHA-256 payload hash are stored in dedicated approval columns.
- Proposer identity is server-assigned `ecc-agent`.
- Reviewer/executor IDs are UUID columns and are verified against the enabled owner allowlist.
- No self-approval by the agent is possible through this workflow.
- Only the same reviewer can execute.
- Hash/revision changes cause rejection at review or execution.
- Partial unique index prevents multiple active approvals for one memory target.
- New RPC functions are executable only by `service_role`; `anon` and `authenticated` cannot execute them.
- Legacy proposal/review RPCs were revoked from API roles and service_role. Legacy execution overloads remain locked.
- No secrets were added or exposed.

## Verification

A transaction-scoped SQL acceptance test passed and rolled back all test data:
- proposal records `ecc-agent` and the exact target snapshot;
- a non-allowlisted reviewer is rejected;
- target tampering before review is rejected;
- an enabled owner review succeeds;
- target tampering after review is rejected at execution;
- unchanged target executes atomically and creates the verified event.

The deployed API version 16 was tested without bearer tokens on all three approval endpoints. Each returned HTTP 401 `Bearer access token required`, and no proposal/review/execution was created.

## Not yet certified

- A live authenticated owner-session end-to-end test has not been performed because no owner access token was available in the execution environment. Do not ask the user to paste an access token into chat.
- The Edge Function uses `verify_jwt=false` as before, but it performs its own Supabase Auth `getUser(token)` validation on protected routes. The health route remains public and read-only.
- No other approval action types are enabled.
