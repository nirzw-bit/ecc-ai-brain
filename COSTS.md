# Cost and Quota Guardrails
Target: $0/month. Only Cloudflare Free resources and GitHub-hosted standard CI runners. No paid AI APIs, paid Workers plans, custom domains, self-hosted runners, paid queues, paid vector search or automatic upgrades.

Before provisioning and again before deployment, verify current official quotas and account billing state. Free quotas are ceilings, not guaranteed service capacity. Exceeding D1 daily row read/write limits can cause requests to fail until reset; application must stop nonessential work earlier.

Worker CPU per invocation is tightly constrained; design dispatcher for tiny resumable batches. Track requests, CPU, D1 rows read/written/storage, R2 storage and operation counts. Keep a safety margin; reject or defer work before projected quota exhaustion.

R2 in the same Cloudflare account is not independent against account suspension or account compromise. A second account/external provider is a future owner-approved resilience enhancement, not part of the $0 certification claim.

No cost certification is valid until actual account plan, billing settings and measured usage are inspected. No paid resource may be enabled without separate approval.
