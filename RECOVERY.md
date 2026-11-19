# Backup and Recovery Specification
## Backup contents
A versioned logical export of all application tables, schema/migration version, export timestamp, record counts and deterministic SHA-256 hashes. Store objects under versioned R2 keys and a separate manifest object.

## Verification
After upload, read the object back, recompute SHA-256 and compare byte-for-byte manifest values. Verify object size, table counts and schema version. A successful upload alone is not a verified backup.

## Restore drill
Restore into a separately provisioned test D1 database, never the source database. Apply migrations to the matching version, import validated rows in bounded batches, then compare counts and canonical per-table hashes. Record duration and recovery point. Delete test resources only after explicit owner approval.

## Independence and retention
R2 is independent of D1 storage but in the same Cloudflare account. A second Cloudflare account or external provider would improve failure-domain independence, but is not provisioned in this phase. Define lifecycle retention only after confirming exact R2 feature support and test its effect. Do not represent lifecycle expiry as object lock. Object Lock/WORM is enabled only if supported and verified for this bucket/account.
