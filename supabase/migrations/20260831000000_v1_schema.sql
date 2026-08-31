-- =============================================================================
-- Migration : 20260831000000_v1_schema
-- Phase     : V1-A1 — V1 schema migration + profile extension
-- Source    : ProjectDocs/05-backend-schema.md  (verbatim — do not deviate)
-- Rules     : .cursor/rules/supabase.mdc
-- =============================================================================
--
-- PURPOSE
--   Adds all V1 tables (handshake_jobs, applications, application_events,
--   interventions, browser_profiles), extends profiles with Handshake credential
--   columns, enforces status CHECK + transition triggers, enables RLS, protects
--   handshake_password_enc from client reads, and defines claim_next_job RPC.
--
-- TABLES (in dependency order)
--   1. profiles          — ALTER: handshake_email, handshake_password_enc
--   2. handshake_jobs      — scraped job listings per user
--   3. applications        — apply queue with status lifecycle
--   4. application_events  — audit timeline per application
--   5. interventions       — OTP / question popups
--   6. browser_profiles    — Playwright session health per user
--
-- RLS STRATEGY
--   Default: authenticated client may SELECT/INSERT/UPDATE/DELETE only rows
--   where profile_id = auth.uid() (application_events scoped via applications).
--   Worker/API writes use service role (bypasses RLS).
--
--   Exception — profiles.handshake_password_enc:
--     Column-level REVOKE prevents authenticated/anon from SELECT on that column.
--     Encryption at rest is handled at the API layer (AES-256-GCM).
--
-- INDEXES (all from 05-backend-schema.md — no speculative additions)
--   UNIQUE handshake_jobs(profile_id, url)
--   UNIQUE applications(profile_id, job_id)
--   INDEX  applications(profile_id, status, priority, queued_at)
--   INDEX  application_events(application_id, created_at)
--   INDEX  interventions(profile_id, status)
--   UNIQUE browser_profiles(profile_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — extend with Handshake credential columns
--    (has_existing_handshake_account already exists in initial_schema)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists handshake_email        text,
  add column if not exists handshake_password_enc text;

-- handshake_password_enc is service-role only. Supabase grants table-level SELECT to
-- authenticated/anon; column REVOKE alone is insufficient — re-grant SELECT on
-- all columns except handshake_password_enc.
revoke select on public.profiles from authenticated, anon;

grant select (
  id,
  first_name,
  last_name,
  student_email,
  phone,
  school_name,
  major,
  degree_pursuing,
  grad_month,
  grad_year,
  school_additional_info,
  job_types,
  locations_open_to,
  job_interests,
  profile_visibility,
  job_alerts_opt_in,
  has_existing_handshake_account,
  handshake_email,
  telegram_chat_id,
  created_at
) on public.profiles to authenticated, anon;

revoke update (handshake_password_enc) on public.profiles from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. handshake_jobs
-- ---------------------------------------------------------------------------
create table public.handshake_jobs (
  id              uuid        primary key default gen_random_uuid(),
  profile_id      uuid        not null references public.profiles (id) on delete cascade,
  url             text        not null,
  title           text        not null,
  company         text,
  location        text,
  has_quick_apply boolean     not null,
  discovered_at   timestamptz not null default now(),
  raw_metadata    jsonb,
  unique (profile_id, url)
);

-- RLS
alter table public.handshake_jobs enable row level security;

create policy "handshake_jobs: users read own rows"
  on public.handshake_jobs
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "handshake_jobs: users insert own rows"
  on public.handshake_jobs
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "handshake_jobs: users update own rows"
  on public.handshake_jobs
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "handshake_jobs: users delete own rows"
  on public.handshake_jobs
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. applications
-- ---------------------------------------------------------------------------
create table public.applications (
  id                    uuid        primary key default gen_random_uuid(),
  profile_id            uuid        not null references public.profiles (id) on delete cascade,
  job_id                uuid        not null references public.handshake_jobs (id) on delete cascade,
  status                text        not null
                                    check (status in (
                                      'QUEUED',
                                      'PROCESSING',
                                      'NEEDS_INPUT',
                                      'SUBMITTING',
                                      'SUBMITTED',
                                      'FAILED',
                                      'REJECTED'
                                    )),
  current_step          text
                                    check (current_step is null or current_step in (
                                      'open_job',
                                      'check_login',
                                      'quick_apply',
                                      'resume',
                                      'questions',
                                      'submit',
                                      'verify'
                                    )),
  priority              int         not null default 100,
  attempt_count         int         not null default 0,
  worker_id             text,
  lock_acquired_at      timestamptz,
  error_code            text,
  error_message         text,
  verification_evidence jsonb,
  queued_at             timestamptz not null default now(),
  started_at            timestamptz,
  submitted_at          timestamptz,
  finished_at           timestamptz,
  updated_at            timestamptz not null default now(),
  unique (profile_id, job_id)
);

-- Queue claim index (from 05-backend-schema.md)
create index applications_queue_claim_idx
  on public.applications (profile_id, status, priority, queued_at);

-- Auto-update updated_at
create trigger applications_set_updated_at
  before update on public.applications
  for each row
  execute function public.set_updated_at();

-- RLS
alter table public.applications enable row level security;

create policy "applications: users read own rows"
  on public.applications
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "applications: users insert own rows"
  on public.applications
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "applications: users update own rows"
  on public.applications
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "applications: users delete own rows"
  on public.applications
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. application_events
-- ---------------------------------------------------------------------------
create table public.application_events (
  id             bigint      generated always as identity primary key,
  application_id uuid        not null references public.applications (id) on delete cascade,
  event_type     text        not null,
  step           text,
  message        text,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);

create index application_events_application_id_created_at_idx
  on public.application_events (application_id, created_at);

-- RLS — scoped via parent application
alter table public.application_events enable row level security;

create policy "application_events: users read own rows"
  on public.application_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.applications a
      where a.id = application_id
        and a.profile_id = auth.uid()
    )
  );

create policy "application_events: users insert own rows"
  on public.application_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.applications a
      where a.id = application_id
        and a.profile_id = auth.uid()
    )
  );

create policy "application_events: users update own rows"
  on public.application_events
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.applications a
      where a.id = application_id
        and a.profile_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.applications a
      where a.id = application_id
        and a.profile_id = auth.uid()
    )
  );

create policy "application_events: users delete own rows"
  on public.application_events
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.applications a
      where a.id = application_id
        and a.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. interventions
-- ---------------------------------------------------------------------------
create table public.interventions (
  id             uuid        primary key default gen_random_uuid(),
  application_id uuid        references public.applications (id) on delete set null,
  profile_id     uuid        not null references public.profiles (id) on delete cascade,
  type           text        not null
                               check (type in (
                                 'OTP',
                                 'EMAIL_CONFIRM',
                                 'UNKNOWN_QUESTION',
                                 'AUTH'
                               )),
  question_text  text,
  options        jsonb,
  status         text        not null default 'OPEN'
                               check (status in (
                                 'OPEN',
                                 'RESOLVED',
                                 'CANCELLED'
                               )),
  answer         text,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index interventions_profile_id_status_idx
  on public.interventions (profile_id, status);

-- RLS
alter table public.interventions enable row level security;

create policy "interventions: users read own rows"
  on public.interventions
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "interventions: users insert own rows"
  on public.interventions
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "interventions: users update own rows"
  on public.interventions
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "interventions: users delete own rows"
  on public.interventions
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. browser_profiles
-- ---------------------------------------------------------------------------
create table public.browser_profiles (
  id                     uuid        primary key default gen_random_uuid(),
  profile_id             uuid        not null unique references public.profiles (id) on delete cascade,
  platform               text        not null default 'handshake',
  status                 text        not null default 'ACTIVE'
                                     check (status in (
                                       'ACTIVE',
                                       'NEEDS_LOGIN',
                                       'NEEDS_ACTION',
                                       'DISABLED'
                                     )),
  last_authenticated_at  timestamptz,
  last_health_check_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Auto-update updated_at
create trigger browser_profiles_set_updated_at
  before update on public.browser_profiles
  for each row
  execute function public.set_updated_at();

-- RLS
alter table public.browser_profiles enable row level security;

create policy "browser_profiles: users read own rows"
  on public.browser_profiles
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "browser_profiles: users insert own rows"
  on public.browser_profiles
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "browser_profiles: users update own rows"
  on public.browser_profiles
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "browser_profiles: users delete own rows"
  on public.browser_profiles
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Status transition enforcement (applications)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_application_status_transition()
returns trigger
language plpgsql
as $$
begin
  -- Allow inserts with any valid status enum (QUEUED, REJECTED, etc.)
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- No status change — allow other column updates
  if old.status = new.status then
    return new;
  end if;

  -- Terminal states: no transitions out
  if old.status in ('SUBMITTED', 'FAILED', 'REJECTED') then
    raise exception 'illegal status transition: % -> % (terminal state)', old.status, new.status;
  end if;

  -- Allowed transitions per 05-backend-schema.md
  if old.status = 'QUEUED' and new.status = 'PROCESSING' then
    return new;
  end if;

  if old.status = 'PROCESSING' and new.status in ('NEEDS_INPUT', 'SUBMITTING', 'FAILED') then
    return new;
  end if;

  if old.status = 'NEEDS_INPUT' and new.status in ('PROCESSING', 'FAILED') then
    return new;
  end if;

  if old.status = 'SUBMITTING' and new.status in ('SUBMITTED', 'FAILED') then
    return new;
  end if;

  raise exception 'illegal status transition: % -> %', old.status, new.status;
end;
$$;

create trigger applications_enforce_status_transition
  before update on public.applications
  for each row
  execute function public.enforce_application_status_transition();

-- ---------------------------------------------------------------------------
-- 8. Atomic queue claim RPC
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_job(
  p_profile_id uuid,
  p_worker_id  text
)
returns public.applications
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.applications;
begin
  update public.applications as a
  set
    status           = 'PROCESSING',
    worker_id        = p_worker_id,
    lock_acquired_at = now(),
    started_at       = coalesce(a.started_at, now()),
    updated_at       = now()
  where a.id = (
    select id
    from public.applications
    where profile_id = p_profile_id
      and status = 'QUEUED'
    order by priority asc, queued_at asc
    for update skip locked
    limit 1
  )
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_next_job(uuid, text) from public;
grant execute on function public.claim_next_job(uuid, text) to service_role;
