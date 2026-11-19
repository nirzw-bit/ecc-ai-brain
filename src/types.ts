export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  OWNER_ISSUER?: string;
  OWNER_AUDIENCE?: string;
  OWNER_SUBJECT?: string;
  APPROVAL_HMAC_KEY?: string;
}
