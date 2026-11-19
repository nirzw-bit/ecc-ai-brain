DROP TRIGGER memory_record_pointer_guard;
CREATE TRIGGER memory_record_pointer_guard
BEFORE UPDATE ON memory_records
WHEN NEW.id != OLD.id
  OR NEW.memory_key != OLD.memory_key
  OR NEW.created_at != OLD.created_at
  OR NEW.current_version != OLD.current_version + 1
  OR NOT EXISTS (
    SELECT 1 FROM memory_versions v
    WHERE v.memory_id=OLD.id AND v.version=NEW.current_version
  )
BEGIN
  SELECT RAISE(ABORT, 'memory_record_pointer_must_reference_inserted_version');
END;

CREATE TRIGGER memory_records_no_delete BEFORE DELETE ON memory_records
BEGIN SELECT RAISE(ABORT, 'memory_records_are_append_only'); END;
CREATE TRIGGER owner_identity_no_update BEFORE UPDATE ON owner_identity
BEGIN SELECT RAISE(ABORT, 'owner_identity_is_immutable'); END;
CREATE TRIGGER owner_identity_no_delete BEFORE DELETE ON owner_identity
BEGIN SELECT RAISE(ABORT, 'owner_identity_is_immutable'); END;

CREATE TRIGGER owner_roles_immutable_fields
BEFORE UPDATE ON owner_roles
WHEN NEW.id != OLD.id OR NEW.owner_id != OLD.owner_id OR NEW.role != OLD.role
  OR NEW.granted_at != OLD.granted_at
  OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
BEGIN SELECT RAISE(ABORT, 'owner_role_grant_is_immutable'); END;
CREATE TRIGGER owner_roles_no_delete BEFORE DELETE ON owner_roles
BEGIN SELECT RAISE(ABORT, 'owner_role_grants_are_audit_records'); END;

CREATE TRIGGER approval_requests_no_delete BEFORE DELETE ON approval_requests
BEGIN SELECT RAISE(ABORT, 'approval_requests_are_audit_records'); END;
CREATE TRIGGER external_probes_no_update BEFORE UPDATE ON external_probes
BEGIN SELECT RAISE(ABORT, 'external_probes_are_append_only'); END;
CREATE TRIGGER external_probes_no_delete BEFORE DELETE ON external_probes
BEGIN SELECT RAISE(ABORT, 'external_probes_are_append_only'); END;
CREATE TRIGGER backup_manifests_no_update BEFORE UPDATE ON backup_manifests
BEGIN SELECT RAISE(ABORT, 'backup_manifests_are_append_only'); END;
CREATE TRIGGER backup_manifests_no_delete BEFORE DELETE ON backup_manifests
BEGIN SELECT RAISE(ABORT, 'backup_manifests_are_append_only'); END;
CREATE TRIGGER system_events_no_update BEFORE UPDATE ON system_events
BEGIN SELECT RAISE(ABORT, 'system_events_are_append_only'); END;
CREATE TRIGGER system_events_no_delete BEFORE DELETE ON system_events
BEGIN SELECT RAISE(ABORT, 'system_events_are_append_only'); END;
CREATE TRIGGER quota_observations_no_update BEFORE UPDATE ON quota_observations
BEGIN SELECT RAISE(ABORT, 'quota_observations_are_append_only'); END;
CREATE TRIGGER quota_observations_no_delete BEFORE DELETE ON quota_observations
BEGIN SELECT RAISE(ABORT, 'quota_observations_are_append_only'); END;

CREATE TRIGGER operational_runs_no_delete BEFORE DELETE ON operational_runs
BEGIN SELECT RAISE(ABORT, 'operational_runs_are_audit_records'); END;
CREATE TRIGGER operational_runs_transition_guard
BEFORE UPDATE ON operational_runs
WHEN OLD.status != 'running'
  OR NEW.status NOT IN ('succeeded','retryable_failure','failed')
  OR NEW.id != OLD.id OR NEW.task_id IS NOT OLD.task_id
  OR NEW.idempotency_key != OLD.idempotency_key
  OR NEW.attempt != OLD.attempt OR NEW.started_at != OLD.started_at
BEGIN SELECT RAISE(ABORT, 'operational_run_transition_invalid'); END;
