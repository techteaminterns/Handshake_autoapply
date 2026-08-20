# Backend Schema — Handshake Auto-Apply Bot (MVP)

## Entities/Collections

### `profiles`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK, references `auth.users.id` |
| first_name | text | not null |
| last_name | text | not null |
| student_email | text | not null, unique, `.edu` format checked at API layer |
| phone | text | not null |
| school_name | text | not null |
| major | text | not null |
| degree_pursuing | text | not null |
| grad_month | text | not null |
| grad_year | int | not null |
| school_additional_info | text | nullable |
| job_types | text[] | subset of {full_time, part_time, internship, not_sure} |
| locations_open_to | text[] | nullable |
| job_interests | text[] | nullable |
| profile_visibility | text | default `community` |
| job_alerts_opt_in | boolean | default true |
| has_existing_handshake_account | boolean | not null |
| telegram_chat_id | text | nullable, set once linked |
| created_at | timestamptz | default now() |

### `gmail_oauth_tokens`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → `profiles.id`, unique |
| refresh_token | text | not null, encrypted at rest |
| access_token | text | nullable, short-lived |
| scope | text | not null, expected `gmail.readonly` |
| connected_at | timestamptz | default now() |
| expires_at | timestamptz | nullable |

### `resumes`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → `profiles.id` |
| storage_path | text | not null, Supabase Storage path |
| file_size_bytes | int | not null, ≤1MB enforced at API layer |
| uploaded_at | timestamptz | default now() |

### `documents` (non-resume, gathered via Telegram)
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → `profiles.id` |
| label | text | not null (e.g. "cover letter", "transcript") |
| storage_path | text | not null, Supabase Storage path |
| file_size_bytes | int | not null, ≤1MB enforced at API layer |
| created_at | timestamptz | default now() |

### `reusable_answers`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → `profiles.id` |
| question_text | text | not null |
| answer_text | text | not null |
| source | text | default `telegram` |
| created_at | timestamptz | default now() |

### `bot_runs`
| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → `profiles.id` |
| job_link | text | not null |
| workflow_run_id | text | not null, Vercel Workflow run identifier |
| status | text | one of `running`, `paused_live_handoff`, `paused_telegram`, `succeeded`, `failed` |
| failure_reason | text | nullable |
| actions_count | int | default 0, used for the 300/day rate limit |
| started_at | timestamptz | default now() |
| completed_at | timestamptz | nullable |

## Relationships
- `profiles` 1—1 `auth.users` (Supabase Auth)
- `profiles` 1—N `resumes`, `documents`, `reusable_answers`, `bot_runs`
- `profiles` 1—1 `gmail_oauth_tokens` (only present if user connected Gmail)

## Indexes
- `resumes.profile_id`, `documents.profile_id`, `reusable_answers.profile_id`, `bot_runs.profile_id` — all FK columns indexed for lookup during a run.
- `reusable_answers (profile_id, question_text)` — composite index, used for the "check before asking again" lookup.

## API endpoints

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/onboarding` | Create/update `profiles` row + resume upload | Supabase session |
| POST | `/api/bot/trigger` | Submit job link, start `handshakeBotWorkflow`, create `bot_runs` row | Supabase session |
| GET | `/api/bot/status/:runId` | Poll/subscribe current `bot_runs` status | Supabase session |
| POST | `/api/bot/live-handoff/resume` | Signal the workflow that the user finished a live-handoff step | Supabase session |
| POST | `/api/telegram/webhook` | Receives bot updates: captures `chat_id` on link ("start") events, writes replies/documents to `reusable_answers`/`documents`, resumes paused workflow | Telegram webhook secret |
| GET | `/api/oauth/gmail/start` | Begins Google OAuth consent (readonly scope) for the current user | Supabase session |
| GET | `/api/oauth/gmail/callback` | Exchanges auth code, stores encrypted refresh token in `gmail_oauth_tokens` | Google OAuth state param |
| GET | `/api/reports/daily` | Cron-invoked; queries `bot_runs` for the day, sends via Resend | Vercel Cron secret |

**RLS:** every table above scoped to `profile_id = auth.uid()` (or joined through it), except Telegram/OAuth-callback/Cron routes, which use service-role access scoped narrowly to the single `profile_id`/`run_id` they're resuming. `gmail_oauth_tokens.refresh_token` is never readable by the client role — service-role only.
