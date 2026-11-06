alter table private.approval_requests
  add column if not exists target_memory_id uuid references private.memory_records(id),
  add column if not exists target_revision integer,
  add column if not exists target_payload_sha256 text,
  add column if not exists reviewed_by_user_id uuid,
  add column if not exists executed_by_user_id uuid;

alter table private.approval_requests
  add constraint approval_requests_target_snapshot_check
  check (
    (target_memory_id is null and target_revision is null and target_payload_sha256 is null)
    or (target_memory_id is not null and target_revision is not null and target_revision > 0
      and target_payload_sha256 ~ '^[0-9a-f]{64}$')
  );

create unique index if not exists approval_requests_one_active_target
  on private.approval_requests(target_memory_id)
  where target_memory_id is not null and status in ('pending','approved');

create or replace function private.ecc_memory_approval_hash(p_memory_id uuid)
returns text language sql stable security definer
set search_path = pg_catalog, private, extensions
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'id',m.id,'memory_key',m.memory_key,'revision',m.revision,
    'record_type',m.record_type,'statement',m.statement,'source',m.source,
    'observed_at',m.observed_at,'confidence',m.confidence,'status',m.status,
    'sensitivity',m.sensitivity,'related_records',m.related_records,
    'revision_note',m.revision_note,'supersedes_id',m.supersedes_id,
    'is_current',m.is_current,'created_at',m.created_at,'updated_at',m.updated_at
  )::text,'UTF8'),'sha256'),'hex')
  from private.memory_records m where m.id=p_memory_id and m.is_current=true;
$function$;

create or replace function public.ecc_approval_propose_v2(
  p_action text,p_memory_id uuid,p_expires_at timestamptz default (now()+interval '7 days')
) returns jsonb language plpgsql
set search_path = pg_catalog, public, private
as $function$
declare v_memory private.memory_records%rowtype; v_expiry timestamptz; v_hash text; v_row private.approval_requests%rowtype;
begin
  if p_action <> 'memory.verify' then raise exception 'Action is not allowlisted'; end if;
  v_expiry:=coalesce(p_expires_at,now()+interval '7 days');
  if v_expiry<=now() or v_expiry>now()+interval '7 days' then
    raise exception 'Expiry must be in the future and no more than seven days';
  end if;
  select * into v_memory from private.memory_records
  where id=p_memory_id and is_current=true for update;
  if not found then raise exception 'Current target memory not found'; end if;
  if v_memory.status<>'proposed' then
    raise exception 'Only proposed memories can be approved for verification';
  end if;
  v_hash:=private.ecc_memory_approval_hash(v_memory.id);
  if v_hash is null then raise exception 'Could not fingerprint target memory'; end if;
  insert into private.approval_requests(action,proposed_by,details,expires_at,target_memory_id,target_revision,target_payload_sha256)
  values(p_action,'ecc-agent',jsonb_build_object('memory_id',v_memory.id,'memory_key',v_memory.memory_key,
    'revision',v_memory.revision,'payload_sha256',v_hash),v_expiry,v_memory.id,v_memory.revision,v_hash)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.ecc_approval_review_v2(
  p_request_id uuid,p_decision text,p_reviewer_user_id uuid
) returns jsonb language plpgsql
set search_path = pg_catalog, public, private
as $function$
declare v_row private.approval_requests%rowtype; v_memory private.memory_records%rowtype; v_hash text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  if p_reviewer_user_id is null or not exists(select 1 from private.ecc_owner_allowlist
    where user_id=p_reviewer_user_id and enabled=true) then
    raise exception 'Reviewer is not an enabled ECC owner';
  end if;
  select * into v_row from private.approval_requests where id=p_request_id for update;
  if not found or v_row.status<>'pending' then raise exception 'Request is not pending or does not exist'; end if;
  if v_row.expires_at is null or v_row.expires_at<=now() then
    update private.approval_requests set status='expired' where id=p_request_id returning * into v_row;
    return jsonb_build_object('id',v_row.id,'status','expired','expires_at',v_row.expires_at);
  end if;
  if v_row.proposed_by<>'ecc-agent' or v_row.target_memory_id is null then
    raise exception 'Approval is not a valid ECC-agent proposal';
  end if;
  select * into v_memory from private.memory_records
  where id=v_row.target_memory_id and is_current=true for update;
  if not found or v_memory.revision<>v_row.target_revision then
    raise exception 'Approval target revision changed; create a new proposal';
  end if;
  v_hash:=private.ecc_memory_approval_hash(v_memory.id);
  if v_hash is distinct from v_row.target_payload_sha256 then
    raise exception 'Approval target payload changed; create a new proposal';
  end if;
  update private.approval_requests set status=p_decision,reviewed_by=p_reviewer_user_id::text,
    reviewed_by_user_id=p_reviewer_user_id,reviewed_at=now()
  where id=p_request_id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.ecc_approval_execute_v2(
  p_request_id uuid,p_executor_user_id uuid
) returns jsonb language plpgsql
set search_path = pg_catalog, public, private
as $function$
declare v_row private.approval_requests%rowtype; v_memory private.memory_records%rowtype; v_hash text;
begin
  if p_executor_user_id is null or not exists(select 1 from private.ecc_owner_allowlist
    where user_id=p_executor_user_id and enabled=true) then
    raise exception 'Executor is not an enabled ECC owner';
  end if;
  select * into v_row from private.approval_requests where id=p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_row.status<>'approved' then raise exception 'Execution blocked: explicit approval required'; end if;
  if v_row.expires_at is null or v_row.expires_at<=now() then
    update private.approval_requests set status='expired' where id=p_request_id returning * into v_row;
    return jsonb_build_object('request_id',v_row.id,'status','expired','expires_at',v_row.expires_at);
  end if;
  if v_row.proposed_by<>'ecc-agent' or v_row.reviewed_by_user_id is null
    or v_row.reviewed_by_user_id<>p_executor_user_id then
    raise exception 'Only the approving ECC owner may execute this approval';
  end if;
  if v_row.target_memory_id is null or v_row.target_revision is null or v_row.target_payload_sha256 is null then
    raise exception 'Approval target snapshot is incomplete';
  end if;
  select * into v_memory from private.memory_records
  where id=v_row.target_memory_id and is_current=true for update;
  if not found or v_memory.revision<>v_row.target_revision then
    raise exception 'Execution blocked: target revision changed';
  end if;
  v_hash:=private.ecc_memory_approval_hash(v_memory.id);
  if v_hash is distinct from v_row.target_payload_sha256 then
    raise exception 'Execution blocked: target payload hash mismatch';
  end if;
  update private.memory_records set status='verified',updated_at=now()
  where id=v_row.target_memory_id and revision=v_row.target_revision
    and is_current=true and status='proposed' returning * into v_memory;
  if not found then raise exception 'Execution blocked: target changed during execution'; end if;
  update private.approval_requests set status='executed',
    executed_by=p_executor_user_id::text,executed_by_user_id=p_executor_user_id
  where id=p_request_id returning * into v_row;
  insert into private.memory_events(memory_id,event_type,actor,details)
  values(v_memory.id,'verified',p_executor_user_id::text,jsonb_build_object(
    'approval_request_id',p_request_id,'reviewed_by_user_id',v_row.reviewed_by_user_id,
    'executed_by_user_id',p_executor_user_id,'target_revision',v_row.target_revision,
    'target_payload_sha256',v_row.target_payload_sha256));
  return jsonb_build_object('request_id',p_request_id,'status','executed',
    'executed_by_user_id',p_executor_user_id,'reviewed_by_user_id',v_row.reviewed_by_user_id,
    'target_memory_id',v_memory.id,'target_revision',v_memory.revision,
    'target_payload_sha256',v_row.target_payload_sha256);
end;
$function$;

revoke all on function private.ecc_memory_approval_hash(uuid) from public,anon,authenticated;
grant execute on function private.ecc_memory_approval_hash(uuid) to service_role;
revoke all on function public.ecc_approval_propose_v2(text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.ecc_approval_review_v2(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.ecc_approval_execute_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ecc_approval_propose_v2(text,uuid,timestamptz) to service_role;
grant execute on function public.ecc_approval_review_v2(uuid,text,uuid) to service_role;
grant execute on function public.ecc_approval_execute_v2(uuid,uuid) to service_role;
revoke execute on function public.ecc_approval_propose(text,jsonb,text,timestamptz) from public,anon,authenticated,service_role;
revoke execute on function public.ecc_approval_review(uuid,text,text) from public,anon,authenticated,service_role;
