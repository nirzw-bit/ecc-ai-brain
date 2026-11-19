# Operations Runbook
## Operating model
One Worker, one Cron Trigger, native D1/R2 bindings. Scheduled work is deterministic and bounded. Each run records a unique idempotency key, lease, attempt count, outcome and timestamps.

## Dispatcher rules
- Claim only due tasks with an atomic lease.
- Use a stable idempotency key per logical task/window.
- Enforce per-run item and time budgets; resume later.
- Retry transient failures with capped attempts and backoff.
- Mark permanent failures and require owner review; never loop indefinitely.
- Record every execution and state transition in operational_runs/system_events.

## Monitoring
Persist critical health, quota and failure observations in D1. Platform logs are supplementary and short-retention. Alert thresholds must be conservative and stop nonessential tasks before free-tier exhaustion.

## Manual recovery
1. Freeze dispatcher execution through a reviewed config change.
2. Preserve current D1 export, R2 objects and run evidence.
3. Identify last verified backup manifest and checksum.
4. Restore only into a separate test D1 first.
5. Reconcile table counts, per-table canonical hashes and schema version.
6. Document recovery point/time and obtain owner approval before any live restore.

## Operational prohibitions
No automatic upgrades, paid plan, production cutover, destructive cleanup, or changes to Supabase/n8n/Railway.
