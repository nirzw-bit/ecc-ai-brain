CREATE UNIQUE INDEX idx_owner_roles_one_active_role
ON owner_roles(owner_id, role) WHERE revoked_at IS NULL;
