-- Memory record pointers may advance only one version at a time.
CREATE TRIGGER memory_record_pointer_guard
BEFORE UPDATE ON memory_records
WHEN NEW.id != OLD.id
  OR NEW.memory_key != OLD.memory_key
  OR NEW.created_at != OLD.created_at
  OR NEW.current_version != OLD.current_version + 1
BEGIN
  SELECT RAISE(ABORT, 'memory_record_metadata_immutable_or_version_must_advance_once');
END;

CREATE TRIGGER memory_version_sequence_guard
BEFORE INSERT ON memory_versions
WHEN NOT EXISTS (
  SELECT 1 FROM memory_records r
  WHERE r.id = NEW.memory_id
    AND NEW.version = r.current_version + 1
    AND (
      (r.current_version = 0 AND NEW.version = 1 AND NEW.supersedes_version IS NULL)
      OR (r.current_version > 0 AND NEW.supersedes_version = r.current_version)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'memory_version_must_be_next_and_supersede_current');
END;

CREATE TRIGGER memory_version_advance_pointer
AFTER INSERT ON memory_versions
BEGIN
  UPDATE memory_records SET current_version = NEW.version WHERE id = NEW.memory_id;
END;
