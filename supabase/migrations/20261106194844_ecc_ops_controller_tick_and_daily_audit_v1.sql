-- ECC Operations Controller v1.1: gate ledger + read-only database audit tick.
-- Cron executes only the database-only audit. Reliability/efficiency remain gated.
create table if not exists private.ecc_ops_gates (
  gate_key text primary key,
  status text not null check (status in ('PASS','FAIL','BLOCKED','NOT_RUN')),
  evidence_locator text,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.ecc_ops_gates enable row level security;
revoke all on table private.ecc_ops_gates from public, anon, authenticated;
grant select, insert, update on table private.ecc_ops_gates to service_role;

insert into private.ecc_ops_gates(gate_key,status)
values ('archive_verification','BLOCKED'), ('reliability_24h','NOT_RUN')
on conflict (gate_key) do nothing;

create or replace function private.ecc_ops_controller_tick()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_task private.ecc_ops_tasks%rowtype;
  v_run_id uuid;
  v_tables_present boolean;
  v_rls_enabled boolean;
  v_no_client_table_access boolean;
  v_service_role_access boolean;
  v_outcome jsonb;
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtext('ecc_ops_controller_daily'));

  select * into v_task
  from private.ecc_ops_tasks
  where task_key = 'independent_auditor'
  for update;

  if not found or v_task.enabled is not true or v_task.state <> 'READY' then
    return jsonb_build_object('status','SKIPPED','reason','AUDITOR_DISABLED_OR_NOT_READY');
  end if;

  insert into private.ecc_ops_runs(task_key,status,controller_version,summary)
  values ('independent_auditor','RUNNING','1.1','Read-only Supabase operations-schema audit')
  returning id into v_run_id;

  select count(*) = 3 into v_tables_present
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relname in ('ecc_ops_tasks','ecc_ops_runs','ecc_ops_evidence')
    and c.relkind = 'r';

  select count(*) = 3 into v_rls_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relname in ('ecc_ops_tasks','ecc_ops_runs','ecc_ops_evidence')
    and c.relrowsecurity is true;

  select
    not has_table_privilege('anon','private.ecc_ops_tasks','select')
    and not has_table_privilege('anon','private.ecc_ops_runs','select')
    and not has_table_privilege('anon','private.ecc_ops_evidence','select')
    and not has_table_privilege('authenticated','private.ecc_ops_tasks','select')
    and not has_table_privilege('authenticated','private.ecc_ops_runs','select')
    and not has_table_privilege('authenticated','private.ecc_ops_evidence','select')
  into v_no_client_table_access;

  select
    has_schema_privilege('service_role','private','usage')
    and has_table_privilege('service_role','private.ecc_ops_tasks','select')
    and has_table_privilege('service_role','private.ecc_ops_runs','select')
    and has_table_privilege('service_role','private.ecc_ops_evidence','select')
  into v_service_role_access;

  v_outcome := jsonb_build_object(
    'tables_present', coalesce(v_tables_present,false),
    'rls_enabled', coalesce(v_rls_enabled,false),
    'anon_authenticated_no_select', coalesce(v_no_client_table_access,false),
    'service_role_read_access', coalesce(v_service_role_access,false)
  );

  if coalesce(v_tables_present,false)
     and coalesce(v_rls_enabled,false)
     and coalesce(v_no_client_table_access,false)
     and coalesce(v_service_role_access,false) then
    v_status := 'PASS';
  else
    v_status := 'FAIL';
  end if;

  update private.ecc_ops_runs
  set status = v_status,
      finished_at = clock_timestamp(),
      outcome = v_outcome,
      summary = case when v_status = 'PASS'
        then 'Operations metadata tables and access boundaries passed.'
        else 'One or more operations metadata schema/access checks failed.'
      end
  where id = v_run_id;

  return jsonb_build_object('run_id',v_run_id,'status',v_status,'outcome',v_outcome);
exception when others then
  if v_run_id is not null then
    update private.ecc_ops_runs
    set status = 'ERROR',
        finished_at = clock_timestamp(),
        summary = left(sqlerrm, 2000),
        outcome = jsonb_build_object('error_code',sqlstate)
    where id = v_run_id and status = 'RUNNING';
  end if;
  raise;
end;
$$;

revoke all on function private.ecc_ops_controller_tick() from public, anon, authenticated;
grant execute on function private.ecc_ops_controller_tick() to service_role;

select cron.schedule(
  'ecc-ops-controller-daily',
  '15 6 * * *',
  'select private.ecc_ops_controller_tick();'
);
