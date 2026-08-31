-- =============================================================================
-- Migration : 20260824000000_gmail_oauth_tokens_realtime
-- Purpose   : Enable Realtime postgres_changes subscription for profiles &
--             gmail_oauth_tokens, and allow authenticated users to verify
--             their own Gmail connection status.
-- =============================================================================

-- 1. Policy for authenticated users to read their own token connection status
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'gmail_oauth_tokens' and policyname = 'gmail_oauth_tokens: users read own row'
  ) then
    create policy "gmail_oauth_tokens: users read own row"
      on public.gmail_oauth_tokens
      for select
      to authenticated
      using (profile_id = auth.uid());
  end if;
end
$$;

-- 2. Add profiles and gmail_oauth_tokens to supabase_realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gmail_oauth_tokens'
  ) then
    alter publication supabase_realtime add table public.gmail_oauth_tokens;
  end if;
end
$$;
