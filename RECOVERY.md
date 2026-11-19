# Backup and Recovery Specification
## Backup contents
A versioned logical export of all application tables, schema/migration version, export timestamp, record counts and deterministic SHA-256 hashes. Store objects under versioned R2 keys and a separate manifest object.

## Verification
After upload, read the object back, recompute SHA-256 and compare byte-for-byte manifest values. Verify object size, table counts and schema version. A successful upload alone is not a verified backup.

## Restore drill
Restore with scripts/restore-backup.mjs on an owner-controlled machine authenticated through Wrangler. The script first checks the source D1 manifest, downloads the R2 object with Wrangler, verifies the archive SHA-256 and per-table hashes, refuses a non-empty test D1, generates an import SQL file, restores into the separately provisioned test D1, and verifies all table counts and canonical per-table hashes. Memory records are imported at version pointer zero and immutable versions are replayed in ascending order so database triggers reconstruct the current-version pointers. The restore test database must have the matching migrations applied. The script never targets the primary database by default. Record duration and recovery point. If an import fails, inspect the test database and recreate only that isolated test database before retrying; never clear the primary database.

## Independence and retention
R2 is independent of D1 storage but in the same Cloudflare account. A second Cloudflare account or external provider would improve failure-domain independence, but is not provisioned in this phase. Define lifecycle retention only after confirming exact R2 feature support and test its effect. Do not represent lifecycle expiry as object lock. Object Lock/WORM is enabled only if supported and verified for this bucket/account.
