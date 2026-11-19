# Backup and Recovery Runbook

## Normal backup
The single Worker writes a versioned JSON archive to the private R2 bucket, reads it back, checks its SHA-256 and byte length, then records an immutable D1 manifest. A backup is valid only when the Worker reports read-back verification and the manifest exists.

## One-command restore drill
Run this from the repository root on an owner-controlled device after npx wrangler login:

~~~sh
npm run restore:test -- --key ecc-orbit/v1/<backup-file>.json
~~~

That is the only required restore input: the R2 object key. The script obtains the expected checksum from the matching manifest in the source D1 database; an optional --sha256 argument is accepted only as an extra cross-check.

The script is deliberately pinned to:
- Source database: ecc-orbit-dev (read-only for the restore process)
- Backup bucket: ecc-orbit-backups-dev
- Restore destination: ecc-orbit-restore-test

These names cannot be overridden through command-line arguments. It refuses to continue if the source manifest is missing, the object checksum differs, the archive format/schema is unsupported, any table checksum/count differs, or the restore destination is not empty. It imports immutable memory versions in ascending order so database triggers rebuild the current-version pointers. It then verifies all 16 table counts and canonical table hashes.

The script never clears a database, never writes to the source database and never restores into the primary database. If the isolated restore database already contains data, stop and inspect it. Recreate only that test database through the Cloudflare dashboard or a separately reviewed command; do not add a destructive reset option to this script.

## Limits and recovery objective
Backups are currently bounded to 250 rows per table and 512 KB per archive. A larger archive fails closed; no partial backup is certified. Record backup time as the recovery point and restore duration as the measured recovery time during the actual Cloudflare drill. Neither value is certified until the remote drill has completed.

## Independence and retention
R2 is separate from D1 storage but remains in the same Cloudflare account and failure domain. A second account or external provider is not provisioned in this phase. Lifecycle expiration and bucket-lock rules must be inspected in the account dashboard before certification; do not describe same-account R2 as independent against account compromise or suspension.
