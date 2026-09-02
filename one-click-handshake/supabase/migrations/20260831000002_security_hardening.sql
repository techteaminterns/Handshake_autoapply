-- =============================================================================
-- Migration : 20260831000002_security_hardening
-- Purpose   : Close remaining V1-A1 security gaps:
--   1. handshake_password_enc — block client UPDATE (and INSERT) via column grants
--   2. claim_next_job — restrict EXECUTE to service_role only
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — handshake_password_enc write isolation
--    Table-level UPDATE/INSERT bypass column REVOKE; re-grant on safe columns only.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated, anon;

grant update (
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
  telegram_chat_id
) on public.profiles to authenticated, anon;

revoke insert on public.profiles from authenticated, anon;

grant insert (
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
  telegram_chat_id
) on public.profiles to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. claim_next_job — service_role only (Supabase default grants EXECUTE to all)
-- ---------------------------------------------------------------------------
revoke execute on function public.claim_next_job(uuid, text) from public;
revoke execute on function public.claim_next_job(uuid, text) from authenticated, anon;
grant execute on function public.claim_next_job(uuid, text) to service_role;
