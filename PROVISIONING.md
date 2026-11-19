# Owner Provisioning Runbook — Free-Tier Development

This guide creates only isolated development resources. Do not change Supabase, n8n, Railway, the GitHub default branch, or any production resource.

## 1. Confirm account and billing
1. Sign in to the Cloudflare dashboard.
2. Confirm the account is on the Free plan.
3. Do not add a paid plan, Workers Paid subscription, custom domain purchase, paid AI service or automatic upgrade.
4. Use the account's workers.dev subdomain for this first deployment.

## 1A. Android-only terminal option (optional)
If you are provisioning from Android and do not have a desktop terminal, use GitHub Codespaces in the browser for the Wrangler commands:

1. Open the repository on GitHub and switch to feat/ecc-orbit-cloudflare-v1.
2. Select Code → Codespaces → Create codespace on feat/ecc-orbit-cloudflare-v1.
3. Use the smallest available machine (2 cores) and set the idle timeout to 5 minutes.
4. In the Codespaces terminal, confirm node --version and npm --version, then run the commands below.
5. Run npx wrangler login and complete the Cloudflare browser authorization.
6. Stop the Codespace as soon as the work is complete.

Cost guard: personal GitHub Free accounts include 120 Codespaces core-hours and 15 GB-month storage. Usage beyond the included quota is blocked if there is no payment method; if a payment method exists, set a $0 Codespaces spending budget with “Stop usage when budget limit is reached” before creating a Codespace. Do not create prebuilds. Check usage and delete the Codespace when finished. This is an optional convenience, not part of the Cloudflare runtime.

References:
- https://docs.github.com/en/billing/concepts/product-billing/github-codespaces
- https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-included-usage

## 2. Create two D1 databases and one R2 bucket
Run these commands from the repository root after installing Node.js LTS:

~~~sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create ecc-orbit-dev
npx wrangler d1 create ecc-orbit-restore-test
npx wrangler r2 bucket create ecc-orbit-backups-dev
~~~

These commands create three resources. Record the two D1 database IDs returned by Wrangler. In wrangler.toml, replace the two REPLACE_AFTER_OWNER_PROVISIONING placeholders with the matching IDs. Do not place API tokens or OAuth secrets in that file.

## 3. Configure R2 retention protections
In Cloudflare Dashboard → R2 Object Storage → ecc-orbit-backups-dev → Settings:

- Under Object Lifecycle Rules, add a rule scoped to prefix ecc-orbit/v1/ that expires objects after 365 days. This bounds storage accumulation.
- Under Bucket Lock Rules, add a rule scoped to prefix ecc-orbit/v1/ with Age retention of 7,776,000 seconds (90 days). This protects backups from overwrite/deletion during the retention window.
- Save and then inspect the resulting rules. Do not claim protection until the dashboard shows both rules active.

Lifecycle expiry is delayed and may take up to 24 hours after the configured expiration. Bucket locks take precedence over lifecycle rules. A bucket lock may prevent deleting objects and can complicate cleanup; preserve the rule unless a deliberate recovery/retention change is approved.

Same-account R2 is not independent of Cloudflare account compromise/suspension. This development design provides storage separation from D1, not second-account disaster independence.

## 4. Configure GitHub OAuth owner sign-in
Create a GitHub OAuth App in GitHub Settings → Developer settings → OAuth Apps → New OAuth App.

- Application name: ECC OrBIt Development
- Homepage URL: the workers.dev URL assigned to the Worker after first deployment
- Authorization callback URL: https://WORKER-NAME.ACCOUNT-SUBDOMAIN.workers.dev/auth/github/callback

The exact workers.dev hostname must be known before saving the callback URL. Do not share the client secret in ChatGPT or commit it.

## 5. Set Worker secrets
After the Worker has been deployed once and the final workers.dev URL is known, set secrets interactively:

~~~sh
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put OWNER_GITHUB_LOGIN
npx wrangler secret put REVIEWER_GITHUB_LOGINS
npx wrangler secret put SESSION_HMAC_KEY
~~~

Enter the values only in the local Wrangler prompt. OWNER_GITHUB_LOGIN must be the exact GitHub login authorized as owner. REVIEWER_GITHUB_LOGINS is a comma-separated allowlist containing at least one distinct GitHub login for the independent reviewer; do not include the owner login. The reviewer must be able to sign in with GitHub separately. Approval endpoints are reviewer-only, and the consume route is mock-only (it never executes an external action). Generate SESSION_HMAC_KEY locally with a cryptographically secure generator, for example:

~~~sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
~~~

Never paste any of these values into chat, GitHub source files, issue comments or logs. OAuth client ID is stored as a server-side secret here to keep the configuration surface simple.

## 6. Apply migrations and deploy the isolated branch
Before remote changes, confirm:
- The checked-out branch is feat/ecc-orbit-cloudflare-v1.
- Both D1 IDs in wrangler.toml match the newly created development databases.
- R2 bucket name is exact.
- Account is Free and billing has not enabled a paid service.
- GitHub Actions CI is green on the commit to deploy.

Then:
~~~sh
npm install
npm run typecheck
npm test
python3 scripts/validate_migrations.py
npx wrangler d1 migrations apply ecc-orbit-dev --remote
npx wrangler d1 migrations apply ecc-orbit-restore-test --remote
npx wrangler deploy
~~~

Deployment creates/updates one Worker and configures exactly one hourly Cron Trigger from wrangler.toml. Do not run these commands until the owner has confirmed resource creation and the final configuration has been reviewed.

## 7. Verify the deployed interface
Open the workers.dev URL on Android and desktop. The public /health endpoint should return only a minimal service status. The root page should show the responsive ECC OrBIt sign-in screen. Complete GitHub OAuth using the authorized account. The page should then show the authenticated login. /api/me must return 401 when no valid owner session is present.

## 8. Test scheduler and backups
Only after owner login and both D1 databases are verified:
1. Insert a test heartbeat task into ecc-orbit-dev with due_at set to the current UTC timestamp, status pending and max_attempts 3.
2. Wait for the single hourly Cron Trigger or invoke the same dispatcher locally against a local D1 test instance.
3. Confirm one operational_runs row, one system_events heartbeat record, task status succeeded, and no duplicate run after the next Cron tick.
4. Insert one backup task. Confirm R2 object creation, read-back SHA-256 verification and backup_manifests row.
5. Restore locally through Wrangler (no Worker route or extra runtime is required):
   ~~~sh
   npm run restore:test -- --key ecc-orbit/v1/<backup-file>.json
   ~~~
   The script reads the expected SHA-256 from the source D1 manifest, downloads the R2 object through Wrangler, verifies the whole-object and per-table hashes, refuses a non-empty target D1, imports memory versions in order, and verifies all 16 table counts and per-table hashes. The source, bucket and restore target are fixed in the script; the restore target cannot be changed by command-line input.

Do not restore into the primary D1. Do not expose restore operations as a public route.

## 9. Owner confirmation required
Before remote migration/deployment, provide confirmation that:
- Cloudflare Free account is active.
- Two D1 databases and one R2 bucket exist.
- R2 lifecycle and bucket-lock rules are visible and active.
- The GitHub OAuth App has been created.
- CI is green on the exact branch commit.

No Cloudflare resource has been provisioned by this repository work. Production cutover remains blocked pending separate approval.
