create table private.ecc_ops_external_probes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.ecc_ops_runs(id),
  request_id bigint not null unique,
  target text not null check (target = 'ecc-memory-api/health'),
  state text not null default 'PENDING' check (state in ('PENDING','PASS','FAIL','ERROR')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  http_status integer,
  timed_out boolean,
  error_present boolean,
  response_sha256 text check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  response_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(response_summary) = 'object')
);

alter table private.ecc_ops_external_probes enable row level security;
revoke all on table private.ecc_ops_external_probes from public, anon, authenticated;
grant select, insert, update on table private.ecc_ops_external_probes to service_role;

create or replace function private.ecc_ops_queue_memory_api_health()
returns uuid
language plpgsql
set search_path = pg_catalog, private, net
as $function$
declare
  v_run_id uuid;
  v_request_id bigint;
begin
  insert into private.ecc_ops_runs
    (task_key, status, started_at, controller_version, summary, outcome)
  values
    ('independent_auditor', 'RUNNING', now(), 'external-health-probe-v1',
     'Queued read-only GET /health probe for ecc-memory-api.',
     jsonb_build_object('probe_scope','GET /health only','target','ecc-memory-api'))
  returning id into v_run_id;

  v_request_id := net.http_get(
    'https://kouvnqcdmsiyifugwesw.supabase.co/functions/v1/ecc-memory-api/health',
    timeout_milliseconds := 10000
  );

  insert into private.ecc_ops_external_probes(run_id, request_id, target)
  values (v_run_id, v_request_id, 'ecc-memory-api/health');

  update private.ecc_ops_runs
  set outcome = outcome || jsonb_build_object('request_id',v_request_id)
  where id=v_run_id;

  return v_run_id;
exception when others then
  if v_run_id is not null then
    update private.ecc_ops_runs
    set status='ERROR', finished_at=now(),
        summary='Failed to queue read-only GET /health probe.',
        outcome=jsonb_build_object('probe_scope','GET /health only','error_class',SQLSTATE)
    where id=v_run_id;
  end if;
  return v_run_id;
end;
$function$;

create or replace function private.ecc_ops_collect_memory_api_health()
returns integer
language plpgsql
set search_path = pg_catalog, private, net, extensions
as $function$
declare
  v_probe record;
  v_payload jsonb;
  v_pass boolean;
  v_count integer := 0;
  v_hash text;
begin
  for v_probe in
    select p.id as probe_id, p.run_id, p.request_id, p.requested_at,
           r.status_code, r.timed_out, r.error_msg, r.content, r.created
    from private.ecc_ops_external_probes p
    join net._http_response r on r.id=p.request_id
    where p.state='PENDING'
    order by p.requested_at
    for update of p
  loop
    v_payload := case
      when v_probe.content is not null and pg_input_is_valid(v_probe.content,'jsonb')
        then v_probe.content::jsonb
      else '{}'::jsonb
    end;

    v_pass := v_probe.status_code=200
      and coalesce(v_probe.timed_out,false)=false
      and v_probe.error_msg is null
      and v_payload->>'ok'='true'
      and v_payload->>'service'='ecc-memory-api'
      and v_payload->>'database'='reachable'
      and v_payload->>'payload_valid'='true';

    v_hash := case when v_probe.content is not null
      then encode(extensions.digest(convert_to(v_probe.content,'UTF8'),'sha256'),'hex')
      else null end;

    update private.ecc_ops_external_probes
    set state=case when v_pass then 'PASS' else 'FAIL' end,
        completed_at=coalesce(v_probe.created,now()),
        http_status=v_probe.status_code,
        timed_out=coalesce(v_probe.timed_out,false),
        error_present=(v_probe.error_msg is not null),
        response_sha256=v_hash,
        response_summary=jsonb_build_object(
          'ok',v_payload->'ok','service',v_payload->'service',
          'database',v_payload->'database','payload_valid',v_payload->'payload_valid')
    where id=v_probe.probe_id;

    update private.ecc_ops_runs
    set status=case when v_pass then 'PASS' else 'FAIL' end,
        finished_at=coalesce(v_probe.created,now()),
        summary=case when v_pass
          then 'Read-only GET /health returned HTTP 200 and the expected ECC API health payload.'
          else 'Read-only GET /health failed HTTP or payload validation.' end,
        outcome=jsonb_build_object(
          'probe_scope','GET /health only','http_status',v_probe.status_code,
          'timed_out',coalesce(v_probe.timed_out,false),
          'error_present',v_probe.error_msg is not null,'payload',v_payload,
          'response_sha256',v_hash,'request_id',v_probe.request_id)
    where id=v_probe.run_id;

    insert into private.ecc_ops_evidence
      (run_id,evidence_type,source_locator,content_sha256,observed_at,metadata)
    values
      (v_probe.run_id,'health_check',
       'supabase:net._http_response#id='||v_probe.request_id,
       v_hash,coalesce(v_probe.created,now()),
       jsonb_build_object('http_status',v_probe.status_code,
         'timed_out',coalesce(v_probe.timed_out,false),
         'error_present',v_probe.error_msg is not null,
         'probe_scope','GET /health only'));

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function private.ecc_ops_queue_memory_api_health() from public, anon, authenticated;
revoke all on function private.ecc_ops_collect_memory_api_health() from public, anon, authenticated;
grant execute on function private.ecc_ops_queue_memory_api_health() to service_role;
grant execute on function private.ecc_ops_collect_memory_api_health() to service_role;

select cron.schedule('ecc-ops-api-health-queue-daily','20 6 * * *',
  'select private.ecc_ops_queue_memory_api_health();');
select cron.schedule('ecc-ops-api-health-collect-daily','25 6 * * *',
  'select private.ecc_ops_collect_memory_api_health();');
