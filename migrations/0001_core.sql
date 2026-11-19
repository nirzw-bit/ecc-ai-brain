CREATE TABLE owner_identity (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(issuer, subject)
);
CREATE TABLE owner_roles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owner_identity(id),
  role TEXT NOT NULL CHECK(role IN ('owner','reviewer')),
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE memory_records (
  id TEXT PRIMARY KEY,
  memory_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version >= 0)
);
CREATE TABLE memory_versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_records(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed','verified','superseded','rejected')),
  supersedes_version INTEGER,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, version)
);
CREATE TABLE memory_evidence (
  id TEXT PRIMARY KEY,
  memory_version_id TEXT NOT NULL REFERENCES memory_versions(id),
  evidence_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  excerpt_sha256 TEXT,
  captured_at TEXT NOT NULL
);
CREATE TABLE memory_evaluations (
  id TEXT PRIMARY KEY,
  memory_version_id TEXT NOT NULL REFERENCES memory_versions(id),
  evaluator TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('pass','fail','pending')),
  notes TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
CREATE TABLE project_records (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE operational_tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','leased','succeeded','failed','paused')),
  lease_owner TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL
);
CREATE TABLE operational_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES operational_tasks(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','retryable_failure','failed')),
  attempt INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT
);
CREATE TABLE operational_gates (
  id TEXT PRIMARY KEY,
  gate_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  policy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  target TEXT NOT NULL,
  scope TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  approver_id TEXT,
  expires_at TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked','consumed','expired')),
  created_at TEXT NOT NULL
);
CREATE TABLE approval_events (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES approval_requests(id),
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE external_probes (
  id TEXT PRIMARY KEY,
  probe_key TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  observed_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);
CREATE TABLE backup_manifests (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  counts_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE TABLE system_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE quota_observations (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  observed_value REAL NOT NULL,
  soft_limit REAL NOT NULL,
  unit TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX idx_memory_versions_record ON memory_versions(memory_id, version DESC);
CREATE INDEX idx_tasks_due ON operational_tasks(status, due_at);
CREATE INDEX idx_runs_task ON operational_runs(task_id, started_at DESC);
CREATE INDEX idx_approvals_status_expiry ON approval_requests(status, expires_at);
CREATE INDEX idx_events_created ON system_events(created_at DESC);

-- Immutable history: updates/deletes to versions/evidence/evaluations are forbidden.
CREATE TRIGGER memory_versions_no_update BEFORE UPDATE ON memory_versions
BEGIN SELECT RAISE(ABORT, 'memory_versions_are_append_only'); END;
CREATE TRIGGER memory_versions_no_delete BEFORE DELETE ON memory_versions
BEGIN SELECT RAISE(ABORT, 'memory_versions_are_append_only'); END;
CREATE TRIGGER memory_evidence_no_update BEFORE UPDATE ON memory_evidence
BEGIN SELECT RAISE(ABORT, 'memory_evidence_is_append_only'); END;
CREATE TRIGGER memory_evidence_no_delete BEFORE DELETE ON memory_evidence
BEGIN SELECT RAISE(ABORT, 'memory_evidence_is_append_only'); END;
CREATE TRIGGER memory_evaluations_no_update BEFORE UPDATE ON memory_evaluations
BEGIN SELECT RAISE(ABORT, 'memory_evaluations_are_append_only'); END;
CREATE TRIGGER memory_evaluations_no_delete BEFORE DELETE ON memory_evaluations
BEGIN SELECT RAISE(ABORT, 'memory_evaluations_are_append_only'); END;
