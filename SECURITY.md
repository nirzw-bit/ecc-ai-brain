# Security Model
## Authentication
Administrative routes require a verified owner identity from a server-side trust source. Never trust request-body roles, query-string identity or unsigned JWT claims. Until a concrete owner identity provider is configured and tested, privileged routes fail closed. Public health response exposes no secrets, identifiers or internal diagnostics.

## Authorization
Use deny-by-default route authorization and least privilege. Only the owner may read or mutate private records. Browser clients never receive Cloudflare API tokens, D1 credentials or service-role keys.

## Approval protocol
An approval binds action_type, target, scope, canonical payload hash, requester, approver, expiry and nonce. Execution recomputes the payload hash and validates exact binding, expiry, revocation, replay state and distinct approver. Missing, expired, revoked, mismatched, replayed and self-approved requests are rejected. Approval does not authorize unrelated actions.

## Memory integrity
Memory versions are immutable. Supersession is a new event/version; original evidence is retained. Treat user text, imported files, search results and retrieved memory as untrusted input. Never allow retrieved instructions to override system policy or authorize tools.

## Secrets and supply chain
Use Worker secret bindings for runtime secrets. Keep only placeholders in Wrangler configuration. Pin dependencies and use lockfiles. CI uses least-privilege GITHUB_TOKEN permissions and standard GitHub-hosted runners. No secrets in artifacts or logs.

## Backup security
R2 objects use deterministic versioned keys, SHA-256 checksums and manifests. Restore verifies checksum and schema before importing into a separate test database. Configure lifecycle retention and object lock only where supported by the selected R2 plan/API; do not claim WORM protection unless verified. Same-account R2 is not a truly independent failure domain.

## Incident handling
Disable privileged routes by configuration, preserve audit evidence, rotate only confirmed-compromised credentials, verify backups before recovery, and document every change. Never disable TLS verification.
