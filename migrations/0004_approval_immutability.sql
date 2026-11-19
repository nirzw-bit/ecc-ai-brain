CREATE TRIGGER approval_events_no_update BEFORE UPDATE ON approval_events
BEGIN SELECT RAISE(ABORT, 'approval_events_are_append_only'); END;
CREATE TRIGGER approval_events_no_delete BEFORE DELETE ON approval_events
BEGIN SELECT RAISE(ABORT, 'approval_events_are_append_only'); END;

CREATE TRIGGER approval_request_immutable_fields
BEFORE UPDATE ON approval_requests
WHEN NEW.id != OLD.id
  OR NEW.action_type != OLD.action_type
  OR NEW.target != OLD.target
  OR NEW.scope != OLD.scope
  OR NEW.payload_sha256 != OLD.payload_sha256
  OR NEW.requester_id != OLD.requester_id
  OR NEW.expires_at != OLD.expires_at
  OR NEW.nonce != OLD.nonce
  OR NEW.created_at != OLD.created_at
  OR (NEW.approver_id IS NOT OLD.approver_id AND NOT (OLD.status='pending' AND NEW.status='approved'))
  OR (NEW.status='approved' AND (NEW.approver_id IS NULL OR NEW.approver_id=NEW.requester_id))
BEGIN SELECT RAISE(ABORT, 'approval_binding_immutable_or_invalid_approver'); END;

CREATE TRIGGER approval_status_transition_guard
BEFORE UPDATE OF status ON approval_requests
WHEN NOT (
  (OLD.status='pending' AND NEW.status IN ('approved','rejected','revoked','expired'))
  OR (OLD.status='approved' AND NEW.status IN ('consumed','revoked','expired'))
)
BEGIN SELECT RAISE(ABORT, 'invalid_approval_status_transition'); END;
