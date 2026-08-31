-- =============================================================================
-- Migration : 20260831000001_profiles_handshake_password_enc_privileges
-- Purpose   : Fix handshake_password_enc client isolation (column REVOKE alone is
--             insufficient when Supabase grants table-level SELECT).
-- =============================================================================

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
