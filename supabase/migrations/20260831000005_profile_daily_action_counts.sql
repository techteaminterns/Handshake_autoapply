-- =============================================================================
-- Migration : 20260831000005_profile_daily_action_counts
-- Phase     : V1-A5 — Side A interface functions
-- Source    : ProjectDocs/07-workflow-side-a.md L20, ProjectDocs/03-workflow.md L94
-- Rules     : .cursor/rules/supabase.mdc
-- =============================================================================
--
-- PURPOSE
--   1. Creates profile_daily_action_counts table for 300-actions/day rate limiting.
--   2. Defines check_and_increment_action_count atomic RPC (service_role only).
--
-- DESIGN
--   One row per (profile_id, date). The RPC uses INSERT … ON CONFLICT DO UPDATE
--   with a WHERE guard on count < 300. If the WHERE guard blocks, no update occurs
--   and the RPC returns false. This is atomic — no race condition between check
--   and increment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profile_daily_action_counts
-- ---------------------------------------------------------------------------
create table if not exists public.profile_daily_action_counts (
  profile_id  uuid  not null references public.profiles(id) on delete cascade,
  date        date  not null default (current_date at time zone 'UTC'),
  count       int   not null default 0,
  primary key (profile_id, date)
);

-- RLS: service-role only writes; no client policy needed.
alter table public.profile_daily_action_counts enable row level security;

-- ---------------------------------------------------------------------------
-- 2. check_and_increment_action_count RPC
--
-- Returns:
--   true  — count was below 300; incremented successfully
--   false — count was already at 300 or above; no change made
-- ---------------------------------------------------------------------------
create or replace function public.check_and_increment_action_count(
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean := false;
begin
  -- Attempt atomic upsert with a conditional increment guard.
  -- If count is already >= 300, the WHERE clause on DO UPDATE blocks the write
  -- and no row is modified, so FOUND remains false.
  insert into public.profile_daily_action_counts (profile_id, date, count)
  values (p_profile_id, (current_date at time zone 'UTC'), 1)
  on conflict (profile_id, date)
  do update set count = public.profile_daily_action_counts.count + 1
  where public.profile_daily_action_counts.count < 300;

  -- FOUND is true if the INSERT or the conditional UPDATE affected a row.
  v_updated := found;

  return v_updated;
end;
$$;

-- Restrict execution to service_role only
revoke all on function public.check_and_increment_action_count(uuid) from public;
grant execute on function public.check_and_increment_action_count(uuid) to service_role;
