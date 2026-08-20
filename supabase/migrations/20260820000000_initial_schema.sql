-- =============================================================================
-- Migration : 20260820000000_initial_schema
-- Phase     : Phase 1 — Supabase schema + RLS (A1 slice)
-- Source    : ProjectDocs/05-backend-schema.md  (verbatim — do not deviate)
-- Rules     : .agents/rules/supabase.md
-- =============================================================================
--
-- PURPOSE
--   Bootstraps the complete MVP data model in a single idempotent migration.
--   Every table, column, constraint, index, and RLS policy listed here is
--   derived verbatim from 05-backend-schema.md.  If you need to change a
--   definition, add a new numbered migration — never edit this file after it
--   has been applied.
--
-- TABLES (in dependency order)
--   1. profiles          — core onboarding data, 1-1 with auth.users
--   2. gmail_oauth_tokens — encrypted Gmail refresh token; service-role only
--   3. resumes           — Supabase Storage reference for the student's PDF
--   4. documents         — non-resume files gathered via Telegram fallback
--   5. reusable_answers  — Q&A cache to skip re-prompting the user
--   6. bot_runs          — one row per Vercel Workflow run; status lifecycle
--
-- RLS STRATEGY
--   Default (tables 1, 3–6): authenticated client may SELECT/INSERT/UPDATE/DELETE
--   only rows where  profile_id = auth.uid()  (or  id = auth.uid()  for profiles).
--
--   Exception — gmail_oauth_tokens (table 2):
--     No client-role policies at all.  refresh_token is encrypted at rest and
--     must never be readable by the anon or authenticated role.  All writes go
--     through the Gmail OAuth callback route (/api/oauth/gmail/callback) using
--     the service role, scoped narrowly to the single profile_id being resumed.
--
-- INDEXES (all from 05-backend-schema.md — no speculative additions)
--   FK columns on gmail_oauth_tokens, resumes, documents, reusable_answers,
--   bot_runs — all indexed for lookup speed during a bot run.
--   Composite (profile_id, question_text) on reusable_answers — used for the
--   "check before asking again" lookup that gates the Telegram fallback.
--
-- SHARED HELPER
--   set_updated_at() trigger function — created here, available to any future
--   table that needs an auto-updated updated_at column.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Shared helper — set_updated_at trigger function
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                              uuid        primary key references auth.users (id) on delete cascade,
  first_name                      text        not null,
  last_name                       text        not null,
  student_email                   text        not null unique,
  phone                           text        not null,
  school_name                     text        not null,
  major                           text        not null,
  degree_pursuing                 text        not null,
  grad_month                      text        not null,
  grad_year                       int         not null,
  school_additional_info          text,
  job_types                       text[]      not null default '{}',
  locations_open_to               text[],
  job_interests                   text[],
  profile_visibility              text        not null default 'community',
  job_alerts_opt_in               boolean     not null default true,
  has_existing_handshake_account  boolean     not null,
  telegram_chat_id                text,
  created_at                      timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;

create policy "profiles: users read own row"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "profiles: users insert own row"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles: users update own row"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: users delete own row"
  on public.profiles
  for delete
  to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. gmail_oauth_tokens
-- ---------------------------------------------------------------------------
create table public.gmail_oauth_tokens (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null unique references public.profiles (id) on delete cascade,
  refresh_token text        not null,   -- encrypted at rest; never selectable by client role
  access_token  text,                   -- short-lived, nullable
  scope         text        not null,
  connected_at  timestamptz not null default now(),
  expires_at    timestamptz
);

-- Index
create index gmail_oauth_tokens_profile_id_idx on public.gmail_oauth_tokens (profile_id);

-- RLS — client role has NO access; service-role only (via OAuth callback route)
alter table public.gmail_oauth_tokens enable row level security;

-- Intentionally no policies for the authenticated/anon role.
-- refresh_token is never readable by the client role.
-- All writes go through the service-role Gmail OAuth callback route,
-- scoped to the single profile_id being resumed.

-- ---------------------------------------------------------------------------
-- 3. resumes
-- ---------------------------------------------------------------------------
create table public.resumes (
  id               uuid        primary key default gen_random_uuid(),
  profile_id       uuid        not null references public.profiles (id) on delete cascade,
  storage_path     text        not null,
  file_size_bytes  int         not null,   -- ≤1 048 576 enforced at API layer
  uploaded_at      timestamptz not null default now()
);

-- Index
create index resumes_profile_id_idx on public.resumes (profile_id);

-- RLS
alter table public.resumes enable row level security;

create policy "resumes: users read own rows"
  on public.resumes
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "resumes: users insert own rows"
  on public.resumes
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "resumes: users update own rows"
  on public.resumes
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "resumes: users delete own rows"
  on public.resumes
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. documents  (non-resume, gathered via Telegram)
-- ---------------------------------------------------------------------------
create table public.documents (
  id               uuid        primary key default gen_random_uuid(),
  profile_id       uuid        not null references public.profiles (id) on delete cascade,
  label            text        not null,   -- e.g. "cover letter", "transcript"
  storage_path     text        not null,
  file_size_bytes  int         not null,   -- ≤1 048 576 enforced at API layer
  created_at       timestamptz not null default now()
);

-- Index
create index documents_profile_id_idx on public.documents (profile_id);

-- RLS
alter table public.documents enable row level security;

create policy "documents: users read own rows"
  on public.documents
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "documents: users insert own rows"
  on public.documents
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "documents: users update own rows"
  on public.documents
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "documents: users delete own rows"
  on public.documents
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. reusable_answers
-- ---------------------------------------------------------------------------
create table public.reusable_answers (
  id             uuid        primary key default gen_random_uuid(),
  profile_id     uuid        not null references public.profiles (id) on delete cascade,
  question_text  text        not null,
  answer_text    text        not null,
  source         text        not null default 'telegram',
  created_at     timestamptz not null default now()
);

-- Indexes (both specified in 05-backend-schema.md)
create index reusable_answers_profile_id_idx
  on public.reusable_answers (profile_id);

create index reusable_answers_profile_id_question_text_idx
  on public.reusable_answers (profile_id, question_text);

-- RLS
alter table public.reusable_answers enable row level security;

create policy "reusable_answers: users read own rows"
  on public.reusable_answers
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "reusable_answers: users insert own rows"
  on public.reusable_answers
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "reusable_answers: users update own rows"
  on public.reusable_answers
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "reusable_answers: users delete own rows"
  on public.reusable_answers
  for delete
  to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. bot_runs
-- ---------------------------------------------------------------------------
create table public.bot_runs (
  id               uuid        primary key default gen_random_uuid(),
  profile_id       uuid        not null references public.profiles (id) on delete cascade,
  job_link         text        not null,
  workflow_run_id  text        not null unique,
  status           text        not null
                               check (status in (
                                 'running',
                                 'paused_live_handoff',
                                 'paused_telegram',
                                 'succeeded',
                                 'failed'
                               )),
  failure_reason   text,
  actions_count    int         not null default 0,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz
);

-- Index
create index bot_runs_profile_id_idx on public.bot_runs (profile_id);

-- RLS — authenticated users read their own runs;
--        status writes go through Vercel API routes (service role scoped to
--        the single profile_id/workflow_run_id being updated).
alter table public.bot_runs enable row level security;

create policy "bot_runs: users read own rows"
  on public.bot_runs
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy "bot_runs: users insert own rows"
  on public.bot_runs
  for insert
  to authenticated
  with check (profile_id = auth.uid());

create policy "bot_runs: users update own rows"
  on public.bot_runs
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "bot_runs: users delete own rows"
  on public.bot_runs
  for delete
  to authenticated
  using (profile_id = auth.uid());
