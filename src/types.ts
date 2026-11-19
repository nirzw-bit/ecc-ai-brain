export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  OWNER_GITHUB_LOGIN?: string;
  SESSION_HMAC_KEY?: string;
}
