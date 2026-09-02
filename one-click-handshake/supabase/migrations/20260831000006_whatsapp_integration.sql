-- =============================================================================
-- Migration : 20260831000006_whatsapp_integration
-- Purpose   : WhatsApp Baileys integration
--             1. Adds whatsapp_phone and whatsapp_session to profiles
--             2. Grants client SELECT and UPDATE privileges for whatsapp_phone & whatsapp_session
--             3. Adds whatsapp_prompt_sent_at and whatsapp_prompt_resolved_at to handshake_jobs
--             4. Updates resolve_job_confirmation RPC to handle both Telegram and WhatsApp prompts
-- =============================================================================

-- 1. profiles — extend with WhatsApp columns
alter table public.profiles
  add column if not exists whatsapp_phone   text,
  add column if not exists whatsapp_session jsonb;

grant select (
  whatsapp_phone,
  whatsapp_session
) on public.profiles to authenticated, anon;

grant update (
  whatsapp_phone,
  whatsapp_session
) on public.profiles to authenticated, anon;

-- 2. handshake_jobs — add WhatsApp prompt tracking timestamps
alter table public.handshake_jobs
  add column if not exists whatsapp_prompt_sent_at timestamptz,
  add column if not exists whatsapp_prompt_resolved_at timestamptz;

create index if not exists handshake_jobs_whatsapp_prompt_idx
  on public.handshake_jobs (profile_id, whatsapp_prompt_sent_at, whatsapp_prompt_resolved_at);

-- 3. Update resolve_job_confirmation RPC to support both Telegram & WhatsApp prompts
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
  -- 1. Lock pending job row (must be prompted via Telegram or WhatsApp and not yet resolved)
  select * into v_job
  from public.handshake_jobs
  where id = p_job_id
    and profile_id = p_profile_id
    and (telegram_prompt_sent_at is not null or whatsapp_prompt_sent_at is not null)
    and telegram_prompt_resolved_at is null
    and whatsapp_prompt_resolved_at is null
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
      return 'ignored_permanent_reject';
    elsif v_existing_status = 'QUEUED' then
      null;
    else
      return 'ignored_terminal';
    end if;
  elsif p_decision = 'no' then
    if v_existing_status is null then
      insert into public.applications (profile_id, job_id, status, finished_at)
      values (p_profile_id, p_job_id, 'REJECTED', now());
    elsif v_existing_status = 'REJECTED' then
      null;
    elsif v_existing_status = 'QUEUED' then
      return 'ignored_already_queued';
    else
      return 'ignored_terminal';
    end if;
  else
    return 'ignored_invalid_decision';
  end if;

  -- 4. Mark prompt resolved on both channels if active
  update public.handshake_jobs
  set
    telegram_prompt_resolved_at = case when telegram_prompt_sent_at is not null then coalesce(telegram_prompt_resolved_at, now()) else telegram_prompt_resolved_at end,
    whatsapp_prompt_resolved_at = case when whatsapp_prompt_sent_at is not null then coalesce(whatsapp_prompt_resolved_at, now()) else whatsapp_prompt_resolved_at end
  where id = p_job_id;

  return 'resolved';
end;
$$;

revoke all on function public.resolve_job_confirmation(uuid, uuid, text) from public;
revoke all on function public.resolve_job_confirmation(uuid, uuid, text) from authenticated, anon;
grant execute on function public.resolve_job_confirmation(uuid, uuid, text) to service_role;
