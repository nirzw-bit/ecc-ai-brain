# ECC Security Review and Secret Handling — 2026-11-06

## Scope and constraints

- Project: `ecc-ai-brain-prototype` (`kouvnqcdmsiyifugwesw`), existing project only.
- Budget: retain the $0 / Free-plan constraint; no upgrade or paid service authorized.
- No secret values are recorded in this document or Git.
- Existing ChatGPT automations are unchanged.

## Secret-management decision

Supabase Vault is already installed (`supabase_vault 0.3.1`) and the existing Vault inventory contains the name `ecc_backup_worker_secret`. Its decrypted value was not read, copied, or disclosed.

Use the following boundaries:

1. Database-side scheduled SQL may read a required value from `vault.decrypted_secrets` at execution time. Do not select, log, return, or copy the decrypted value into run evidence.
2. Edge Functions must use Supabase Edge Function Secrets (Dashboard / `supabase secrets set`) for values consumed by Deno through `Deno.env.get()`. Vault values are not automatically injected into Edge Function environments.
3. Railway services must use Railway environment variables for values consumed by Railway deployments. Do not place secrets in source code, SQL migrations, GitHub Actions logs, or frontend bundles.
4. Add a new secret only when a named integration actually requires it. Use a unique name, rotate the old value when needed, and keep the secret value out of ChatGPT messages and Git.
5. The available Supabase connector exposes no secret-write or Auth-config mutation action. Do not emulate those operations by putting credential values in source or SQL text.

## Private-schema RLS review

The latest Security Advisor reports 18 `private.*` tables with RLS enabled and no policies. Catalog inspection found:

- `anon` and `authenticated` have no `USAGE` on schemas `private` or `vault`.
- No `anon` or `authenticated` table grants exist on those 18 private tables.
- Table grants, where present, are scoped to `service_role`; four growth tables have no grants to the checked API roles.
- RLS remains enabled.

This is a deliberate deny-by-default configuration, not evidence of public exposure. Do not add permissive policies merely to silence the INFO-level linter. Revisit each table only if a future design intentionally exposes it to a client role; then add a table-specific owner/tenant policy and the minimum required grants.

## Leaked-password protection

The Security Advisor reports this setting is disabled. Current Supabase documentation says the Have I Been Pwned leaked-password check is available on Pro and above. The project is on the Free plan and the user has a strict $0 constraint. Therefore this control is BLOCKED by plan eligibility; do not upgrade or create a paid charge without separate approval.

On the Free plan, configure the available password-strength controls in Authentication → Sign In / Providers → Email (minimum length and character requirements). Recommended minimum length: 12 characters. This does not replace the leaked-password check.

Reference: https://supabase.com/docs/guides/auth/password-security

## Approval execution safety lock

The legacy `public.ecc_approval_execute(uuid, text)` function accepted caller-supplied executor text and did not bind execution to an immutable target memory UUID, revision, and payload hash. Both legacy overloads are now non-executable by `PUBLIC`, `anon`, `authenticated`, and `service_role`.

A replacement must validate:
- exact target memory UUID;
- exact current revision;
- canonical payload hash;
- expiry and revocation;
- reviewer identity from a verified owner/reviewer session, not caller-supplied text;
- proposer/reviewer separation (no self-approval);
- executor identity and action-specific scope;
- atomic compare-and-swap of the target revision;
- immutable audit evidence.

Do not re-enable either legacy overload. Approval execution remains disabled until the replacement is implemented and tested end-to-end against an isolated target.

## Verification snapshot

- Vault extension installed: PASS.
- Existing secret name present without reading its value: PASS.
- Private schema unavailable to `anon` / `authenticated`: PASS.
- No `anon` / `authenticated` grants on private tables: PASS.
- RLS remains enabled: PASS.
- Leaked-password protection: BLOCKED by Free-plan eligibility.
- Approval execution grants revoked and verified: PASS.
- Cron job active but no scheduled run record yet: NOT RUN / PENDING.
