# ECC AI Brain — ECC OrBIt

**Architecture:** GitHub + Cloudflare, Version 1.0 (19 November 2026)  
**Branch:** feat/ecc-orbit-cloudflare-v1  
**Stage:** isolated development build — not production

ECC OrBIt is an evidence-backed personal AI system with append-only, versioned memory, owner authentication, approval gates, bounded scheduled tasks and independently stored backup archives.

## Current architecture
- GitHub is the single source of truth.
- One Cloudflare Worker is the only application runtime.
- D1 stores versioned memory, provenance, identity, approvals, tasks, runs, events and quota observations.
- R2 stores versioned SHA-256-verified backup archives.
- One hourly Cron Trigger dispatches at most one bounded task per tick.
- ChatGPT is the interactive reasoning interface; deterministic backend work does not call paid AI APIs.

## Read first
- [Architecture](ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Operations](OPERATIONS.md)
- [Recovery](RECOVERY.md)
- [Deployment](DEPLOYMENT.md)
- [Owner provisioning steps](PROVISIONING.md)
- [Cost and quota guardrails](COSTS.md)
- [Integration boundaries](INTEGRATIONS.md)
- [Testing and evidence policy](TESTING.md)
- [Changelog](CHANGELOG.md)

## Development commands
~~~sh
npm install
npm run typecheck
npm test
python3 scripts/validate_migrations.py
npx wrangler dev
~~~

Cloudflare resource IDs are intentionally placeholders until the owner provisions the two D1 databases and one R2 bucket. No secrets are stored in the repository.

## Safety status
- Supabase, n8n and Railway are untouched.
- No production cutover or decommissioning is authorized.
- Privileged routes fail closed until the owner configures GitHub OAuth secrets and verifies owner sign-in.
- Approval requests can be created, but consequential approval execution remains blocked until a separate reviewer identity is provisioned and authenticated.
- Live Cloudflare deployment, Cron execution, R2 backup/restore, device acceptance and actual account usage are NOT VERIFIED.
