# Isolated Development Deployment
## Preconditions
- Owner-created Cloudflare account on Free plan; no billing/upgrade approval.
- One D1 primary database, one separate test D1 database, one R2 bucket.
- One Worker service and exactly one Cron Trigger.
- Confirm workers.dev is available; no custom domain purchase.
- Owner identity/authentication provider configured and tested before enabling privileged endpoints.

## Local setup
Install supported Node.js LTS and Wrangler. From repository root:
~~~sh
npm ci
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
~~~
These are inspection commands. Do not run create/deploy commands until owner confirms resources and reviews exact names.

## Provisioning
Create primary and test D1 databases and one R2 bucket in Cloudflare dashboard or with reviewed Wrangler commands. Record generated database IDs in ignored local configuration; commit no secrets. Bind primary D1 as DB and R2 as BACKUPS in wrangler.toml. Test D1 is used only by restore tooling and must not be exposed to public routes.

## Migrations and deployment
~~~sh
npx wrangler d1 migrations apply ecc-orbit-dev --local
npm test
npm run typecheck
~~~
Remote migrations and deployment are gated until owner confirms resource inventory and exact free-tier configuration. Configure one Cron schedule only. Use Wrangler secret put interactively for server-side secrets; never paste secret values into chat or commit them.

## Rollback
Use Git revert on the isolated branch and redeploy only after review. Do not modify main or legacy services. Production cutover is out of scope.
