# Cost and Quota Guardrails
Target: $0/month. Only Cloudflare Free resources and GitHub-hosted standard CI runners. No paid AI APIs, paid Workers plans, custom domains, self-hosted runners, paid queues, paid vector search or automatic upgrades.

## Cloudflare Free ceilings to monitor
Verified against Cloudflare documentation on 19 November 2026. Recheck before deployment because provider limits can change.

| Service | Free allowance / ceiling | ECC control |
|---|---:|---|
| Workers | 100,000 requests/day; 10 ms CPU per invocation | One Worker; one hourly Cron; one-task bounded dispatch |
| D1 | 5 million rows read/day; 100,000 rows written/day; 5 GB total account storage; 500 MB per database; 10 databases/account | Primary + isolated restore-test DB; small indexed queries; soft limits below provider ceilings |
| R2 Standard | 10 GB-month storage; 1 million Class A operations/month; 10 million Class B operations/month; free egress | Versioned JSON objects; one read-back per backup; retention policy; 2 MB backup-size cap and 1,000-row/table cap |

Official references:
- Workers pricing and limits: https://developers.cloudflare.com/workers/platform/pricing/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/

## Guardrails
Free quotas are ceilings, not guaranteed service capacity. Exceeding D1 daily row read/write limits can cause queries to fail until the UTC reset. Application soft thresholds are intentionally lower than provider limits. The quota module currently defines conservative thresholds, but platform usage telemetry is not yet connected; therefore live quota compliance remains NOT VERIFIED.

Worker CPU per invocation is tightly constrained. The dispatcher processes at most one task per tick, uses a 90-second lease, and caps retries at three. Backup export is capped at 250 rows per table and 512 KB per archive. A backup exceeding these limits fails closed and requires a reviewed, bounded export strategy rather than a plan upgrade.

R2 in the same Cloudflare account is not independent against account suspension or account compromise. A second account/external provider is a future owner-approved resilience enhancement, not part of the $0 certification claim.

GitHub Actions uses standard hosted runners. CI must remain within the account's included minutes; no self-hosted runner or paid overage is authorized.

No cost certification is valid until actual account plan, billing settings and measured usage are inspected. No paid resource may be enabled without separate approval.
