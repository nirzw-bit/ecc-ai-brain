-- PROPOSED ONLY: do not apply to production until reviewed and approved.
-- ECC Operations Controller v1: persistent task state and evidence metadata.
-- No raw conversation or memory payloads are stored in these tables.

create table if not exists private.ecc_ops_tasks (
  task_key text primary key,
  role_name text not null,
  state text not null default 'BLOCKED'
    check (state in ('READY','BLOCKED','RUNNING','COMPLETED','FAILED','PAUSED')),
  enabled boolean not null default false,
  schedule_description text,
  prerequisites text[] not null default '{}',
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecc_ops_tasks_key_nonempty check (length(btrim(task_key)) > 0),
  constraint ecc_ops_tasks_role_nonempty check (length(btrim(role_name)) > 0)
);

create table if not exists private.ecc_ops_runs (
  id uuid primary key default gen_random_uuid(),
  task_key text not null references private.ecc_ops_tasks(task_key),
  status text not null
    check (status in ('RUNNING','PASS','FAIL','BLOCKED','CANCELLED','ERROR')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  controller_version text not null,
  summary text check (summary is null or length(summary) <= 2000),
  outcome jsonb not null default '{}'::jsonb
    check (jsonb_typeof(outcome) = 'object'),
  constraint ecc_ops_runs_time_order check (finished_at is null or finished_at >= started_at)
);

create unique index if not exists ecc_ops_one_running_run_per_task
  on private.ecc_ops_runs(task_key) where status = 'RUNNING';

create index if not exists ecc_ops_runs_task_started
  on private.ecc_ops_runs(task_key, started_at desc);

create table if not exists private.ecc_ops_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.ecc_ops_runs(id),
  evidence_type text not null
    check (evidence_type in ('test_log','health_check','archive_verification','security_review','manual_review','deployment_record')),
  source_locator text not null check (length(btrim(source_locator)) between 1 and 2000),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists ecc_ops_evidence_run_observed
  on private.ecc_ops_evidence(run_id, observed_at desc);

alter table private.ecc_ops_tasks enable row level security;
alter table private.ecc_ops_runs enable row level security;
alter table private.ecc_ops_evidence enable row level security;

revoke all on table private.ecc_ops_tasks from public, anon, authenticated;
revoke all on table private.ecc_ops_runs from public, anon, authenticated;
revoke all on table private.ecc_ops_evidence from public, anon, authenticated;

-- Server-side controller only. No direct browser/API grants.
grant select, insert, update on table private.ecc_ops_tasks to service_role;
grant select, insert, update on table private.ecc_ops_runs to service_role;
grant select, insert on table private.ecc_ops_evidence to service_role;

insert into private.ecc_ops_tasks
  (task_key, role_name, state, enabled, schedule_description, prerequisites)
values
  ('independent_auditor', 'Independent Auditor', 'READY', false,
   'Daily read-only audit; schedule remains disabled until deployment approval.', '{}'),
  ('reliability_24h', '24-Hour Reliability Check', 'BLOCKED', false,
   'One continuous 24-hour observation window after archive verification passes.',
   array['archive_verification:PASS']),
  ('efficiency_challenge', 'Efficiency Challenge', 'BLOCKED', false,
   'Deferred until the 24-hour reliability check completes with PASS.',
   array['reliability_24h:PASS'])
on conflict (task_key) do nothing;
