# ECC Read-Only External Health Probe — 2026-11-06

## What was implemented

A read-only external health probe for the deployed `ecc-memory-api` Edge Function.

- Request: `GET https://kouvnqcdmsiyifugwesw.supabase.co/functions/v1/ecc-memory-api/health`
- No bearer token, service-role key, or backup-worker secret is sent.
- No POST, PUT, PATCH, or DELETE requests are made.
- No memory, approval, backup, or application records are changed by the probe.
- The result is written to private ECC operations run/evidence tables with a SHA-256 digest of the health response.

## Scheduled jobs

Both jobs are active in `cron.job`:

| Job | UTC schedule | Kampala time |
|---|---:|---:|
| `ecc-ops-api-health-queue-daily` | 06:20 daily | 09:20 daily |
| `ecc-ops-api-health-collect-daily` | 06:25 daily | 09:25 daily |

The existing `ecc-ops-controller-daily` job remains active at 06:15 UTC (09:15 Kampala). No existing ChatGPT automation was changed.

## Manual verification

A manual invocation of the queue and collection functions completed successfully:

- Run ID: `5977f4cf-2f0b-48d4-8c60-5f0b5d0aa610`
- Result: `PASS`
- HTTP status: `200`
- Payload checks: `ok=true`, service `ecc-memory-api`, database `reachable`, payload `valid`
- Timeout: false
- Error: none
- Response SHA-256: `a979422f3f66b1a6036630cff8d0b070e3adc05e9a241c46fc62d96fc22acc0b`
- Evidence locator: `supabase:net._http_response#id=2`

This proves the function and evidence collector work for one successful manual probe. It does **not** yet prove the scheduled jobs have run; their first scheduled execution is pending.

## Scope limitations

This is a health endpoint check only. It does not test authenticated owner access, approval execution, memory writes, backups, Railway service health, model/tool prompt-injection behavior, or 24-hour reliability. The older bundled health-monitor script was inspected but not executed because it sends multiple POST security probes to production. A later, separately reviewed isolated test suite is required for those checks.

## Security

The probe functions are in the non-exposed `private` schema, with execution revoked from `PUBLIC`, `anon`, and `authenticated`. Only `service_role` has explicit execute grants; scheduled jobs execute under the database owner. The response body is limited to the health payload and its digest; no secret material is collected.
