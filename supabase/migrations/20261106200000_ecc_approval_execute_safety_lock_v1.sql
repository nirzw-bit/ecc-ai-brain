REVOKE EXECUTE ON FUNCTION public.ecc_approval_execute(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ecc_approval_execute(uuid, text) IS 'DISABLED BY ECC SAFETY LOCK 2026-11-06: legacy approval execution did not bind approval to an immutable memory UUID, revision, and payload hash. Do not re-grant until the replacement workflow is verified.';
