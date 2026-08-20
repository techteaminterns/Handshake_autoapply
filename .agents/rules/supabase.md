---
description: Supabase schema and data access conventions
globs: supabase/**, api/**
alwaysApply: false
---

# Supabase rules

- Table names, field names, and types must match `05-backend-schema.md` exactly. If a task seems to need a field or table not in that doc, stop and flag it rather than adding one silently — the doc is the source of truth, not the other way around.
- RLS is mandatory on every table before it's used by any API route — no table goes live "temporarily" without RLS while auth is figured out later.
- Default RLS policy: `profile_id = auth.uid()` (or joined through it) for the client (anon/authenticated) role.
- Service-role access is scoped narrowly to three routes only: the Telegram webhook, the Gmail OAuth callback, and the daily-report cron — each restricted to the single `profile_id`/`run_id` it's actually resuming or reporting on, not broad table access.
- `gmail_oauth_tokens.refresh_token` is encrypted at rest and must never be selectable by the client (anon/authenticated) role, never returned in an API response, and never logged.
- Migrations live under `supabase/migrations/` — one migration per schema change, named descriptively, never edited after being applied (write a new migration instead).
- Indexes: keep the ones specified in `05-backend-schema.md` (all FK columns, plus the `reusable_answers (profile_id, question_text)` composite) — don't add speculative indexes without a stated reason.
