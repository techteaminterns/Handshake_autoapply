-- =============================================================================
-- Migration : 20260831000003_telegram_job_confirmation
-- Phase     : V1-A4 — Telegram job confirmation state machine & matching design
-- Source    : ProjectDocs/03-workflow.md, ProjectDocs/05-backend-schema.md, ProjectDocs/07-workflow-side-a.md
-- Rules     : .cursor/rules/supabase.mdc
-- =============================================================================
--
-- PURPOSE
--   1. Adds telegram_prompt_sent_at and telegram_prompt_resolved_at columns to handshake_jobs.
--   2. Adds index for efficient lookup of unconfirmed / awaiting prompt jobs.
--   3. Defines resolve_job_confirmation atomic RPC (service_role only).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. handshake_jobs — add Telegram prompt tracking timestamps
-- ---------------------------------------------------------------------------
alter table public.handshake_jobs
  add column if not exists telegram_prompt_sent_at timestamptz,
  add column if not exists telegram_prompt_resolved_at timestamptz;

create index if not exists handshake_jobs_telegram_prompt_idx
  on public.handshake_jobs (profile_id, telegram_prompt_sent_at, telegram_prompt_resolved_at);

-- ---------------------------------------------------------------------------
-- 2. Atomic resolve_job_confirmation RPC
-- ---------------------------------------------------------------------------
create or replace function public.resolve_job_confirmation(
  p_profile_id uuid,
  p_job_id     uuid,
  p_decision   text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.handshake_jobs;
  v_existing_status text;
begin
  -- 1. Lock pending job row (must be prompted and not yet resolved)
  select * into v_job
  from public.handshake_jobs
  where id = p_job_id
    and profile_id = p_profile_id
    and telegram_prompt_sent_at is not null
    and telegram_prompt_resolved_at is null
  for update;

  if not found then
    return 'ignored_duplicate';
  end if;

  -- 2. Check existing application for this job
  select status into v_existing_status
  from public.applications
  where profile_id = p_profile_id
    and job_id = p_job_id;

  -- 3. Apply decision per state machine rules
  if p_decision = 'yes' then
    if v_existing_status is null then
      insert into public.applications (profile_id, job_id, status, queued_at)
      values (p_profile_id, p_job_id, 'QUEUED', now());
    elsif v_existing_status = 'REJECTED' then
      -- Permanent skip per 03-workflow.md L52
      return 'ignored_permanent_reject';
    elsif v_existing_status = 'QUEUED' then
      -- Idempotent
      null;
    else
      return 'ignored_terminal';
    end if;
  elsif p_decision = 'no' then
    if v_existing_status is null then
      insert into public.applications (profile_id, job_id, status, finished_at)
      values (p_profile_id, p_job_id, 'REJECTED', now());
    elsif v_existing_status = 'REJECTED' then
      -- Idempotent
      null;
    elsif v_existing_status = 'QUEUED' then
      -- Cannot UPDATE QUEUED -> REJECTED per DB trigger constraint
      return 'ignored_already_queued';
    else
      return 'ignored_terminal';
    end if;
  else
    return 'ignored_invalid_decision';
  end if;

  -- 4. Mark prompt resolved
  update public.handshake_jobs
  set telegram_prompt_resolved_at = now()
  where id = p_job_id;

  return 'resolved';
end;
$$;

-- Security: service_role only
revoke all on function public.resolve_job_confirmation(uuid, uuid, text) from public;
revoke all on function public.resolve_job_confirmation(uuid, uuid, text) from authenticated, anon;
grant execute on function public.resolve_job_confirmation(uuid, uuid, text) to service_role;
