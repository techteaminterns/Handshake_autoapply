# OneClickHandshake

Browser-automation bot that applies to Handshake jobs on a student's behalf, driven by a one-time onboarding form and orchestrated as durable Vercel Workflow steps.

> **Status:** Phase 1 — Supabase schema + RLS shipped; onboarding API and RN screen are next.

---

## What it does

1. Student fills a short onboarding form (React Native) → profile + resume stored in Supabase.
2. Student submits a Handshake job link → triggers `handshakeBotWorkflow`.
3. Bot authenticates to Handshake (new-account creation **or** OTP login via Gmail readonly OAuth).
4. Bot completes Quick Apply / Apply, attaches the stored resume via "Upload new," and answers reusable screening questions.
5. Missing documents or novel questions pause the workflow and prompt the student over Telegram; answers are saved for reuse.
6. Unhandled blocking steps surface a live browser view (live handoff) in the app.

---

## Stack

| Layer | Tool |
|---|---|
| Frontend | React Native (Expo) |
| Backend / DB / Auth | Supabase (Postgres, Storage, RLS) |
| API + orchestration | Vercel Functions + Vercel Workflows |
| Browser automation | `playwright-core` + `@sparticuz/chromium` |
| OTP read | Gmail API (readonly OAuth scope) |
| Missing doc/answer capture | Telegram Bot API |
| Transactional email | Resend |

---

## Project docs

All six spec files live under [`ProjectDocs/`](./ProjectDocs/):

| File | Purpose |
|---|---|
| [`01-prd.md`](./ProjectDocs/01-prd.md) | Product requirements & success metrics |
| [`02-trd.md`](./ProjectDocs/02-trd.md) | Technical architecture & stack rationale |
| [`03-workflow.md`](./ProjectDocs/03-workflow.md) | Step-by-step bot workflow (Handshake selectors, branching) |
| [`04-ui-ux.md`](./ProjectDocs/04-ui-ux.md) | Onboarding screen field list & UI conventions |
| [`05-backend-schema.md`](./ProjectDocs/05-backend-schema.md) | Supabase table definitions, indexes, RLS rules, API endpoints |
| [`06-implementation.md`](./ProjectDocs/06-implementation.md) | Phase-by-phase build plan & checkpoints |

---

## Phase 1 — What was shipped

### Supabase schema (`supabase/migrations/20260820000000_initial_schema.sql`)

All six tables defined in `05-backend-schema.md`, applied in a single migration:

| Table | Purpose |
|---|---|
| `profiles` | Core onboarding data: identity, school, job preferences, `has_existing_handshake_account`, `telegram_chat_id` |
| `gmail_oauth_tokens` | Encrypted Gmail refresh/access tokens; **zero** client-role read access (service-role only) |
| `resumes` | Supabase Storage path + size for the student's resume PDF |
| `documents` | Non-resume files gathered via Telegram (cover letters, transcripts, etc.) |
| `reusable_answers` | Screening Q&A cache: checked before every Telegram fallback prompt |
| `bot_runs` | One row per workflow run; tracks status, `actions_count` (300/day cap), and `workflow_run_id` |

**RLS:** every table has RLS enabled. Default policy: `profile_id = auth.uid()` (or `id = auth.uid()` for `profiles`).
**Exception — `gmail_oauth_tokens`:** no client-role policies at all; all writes go through the Gmail OAuth callback route using the service role.

**Indexes** (matching `05-backend-schema.md` exactly):
- FK columns on `resumes`, `documents`, `reusable_answers`, `bot_runs`, `gmail_oauth_tokens` — all indexed.
- Composite `(profile_id, question_text)` on `reusable_answers` for the "check before asking again" lookup.

### Agent rules (`.agents/rules/`)

Four scoped rule files govern each area of the codebase:

| File | Scope | Key constraints |
|---|---|---|
| [`supabase.md`](./.agents/rules/supabase.md) | `supabase/**, api/**` | Schema fidelity to `05-backend-schema.md`; RLS mandatory; `refresh_token` never client-readable |
| [`app.md`](./.agents/rules/app.md) | `app/**, screens/**, components/**` | Field set from `04-ui-ux.md`; no direct service-role table access from app; resume enforced <1 MB client-side |
| [`bot_playwright.md`](./.agents/rules/bot_playwright.md) | `bot/**, workflows/steps/**` | `playwright-core` + `@sparticuz/chromium` only; Quick Apply preferred; always "Upload new"; 300/day cap checked per action |
| [`workflows.md`](./.agents/rules/workflows.md) | `workflows/**, api/bot/**` | `'use workflow'` / `'use step'` only; no bare polling loops; long waits are workflow-level pauses; every branch ends at `safeExit` |

### RLS checkpoint test (`1test.js`)

Quick smoke test confirming cross-user reads return an empty array (not leaked data):

```bash
node 1test.js
```

Requires `.env.development.local` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set, and two seeded test users in the project's Supabase instance.

---

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | All API routes, RLS test | Public project URL |
| `SUPABASE_ANON_KEY` | App & API routes | Client role; enforced by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | OAuth callback, Telegram webhook, cron | Never exposed to client |
| `TELEGRAM_BOT_TOKEN` | Telegram webhook | App-level secret; per-user linkage via `chat_id` only |
| `GOOGLE_OAUTH_CLIENT_ID` | Gmail OAuth start/callback | Google Cloud project, Testing status |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Gmail OAuth callback | Never returned to client |
| `RESEND_API_KEY` | Daily report (Phase 6) | Not yet wired |

Store all secrets in Vercel environment variables; never commit plaintext credentials.

---

## Security constraints

- **No plaintext credentials** — Handshake and email passwords are never stored. OTP flow uses Gmail readonly OAuth.
- **`gmail_oauth_tokens.refresh_token`** — encrypted at rest; service-role read only; never in API responses or logs.
- **Telegram bot token** — single app-level env var; never collected from users. Per-user linkage is `chat_id` only.
- **RLS everywhere** — every table holding personal data, credentials, resumes, or Q&A history has RLS enabled before any API route touches it.
- **300 actions/day cap** — enforced via `bot_runs.actions_count`; bot halts and logs on breach, never silently retries.
- **Resume upload** — always "Upload new" in Handshake; never selects from the existing-documents dropdown.

---

## What's next (Phase 1 remainder → Phase 2)

- `/api/onboarding` — writes `profiles` row + uploads resume to Supabase Storage.
- `/api/telegram/webhook` — captures `chat_id` on "start" deep-link event.
- `/api/oauth/gmail/start` + `/api/oauth/gmail/callback` — per-user Gmail readonly consent + encrypted token storage.
- React Native onboarding screen — all fields from `04-ui-ux.md`, Telegram link button, conditional Gmail OAuth button.
- Phase 2: `handshakeBotWorkflow` skeleton, `createAccount` step, `otpLogin` step.
