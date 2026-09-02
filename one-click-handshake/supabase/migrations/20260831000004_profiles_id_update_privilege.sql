-- =============================================================================
-- Migration : 20260831000004_profiles_id_update_privilege
-- Purpose   : Grant update on profiles(id) to authenticated/anon to enable
--             Postgres ON CONFLICT (id) DO UPDATE (upsert) queries under RLS.
-- =============================================================================

grant update (id) on public.profiles to authenticated, anon;
