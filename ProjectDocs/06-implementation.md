# Implementation Plan — Handshake Auto-Apply Bot (MVP)

## Current status
- **Side A** (see `07-workflow-side-a.md`): A1 (Supabase schema + RLS) ✅ complete. A2 (onboarding screen + resume upload) ✅ complete. A3 (Telegram linking infra) ✅ complete. A4 (Gmail OAuth + OTP read) ⚠️ partial — OAuth consent flow and encrypted token storage are done; the `readOtpFromGmail` OTP-read piece is postponed until the mock Handshake site exists to test against. A5–A9 not started.
- **Next up:** build the Mock Handshake test site (Phase 1.5 below) — needed before A5 (workflow skeleton + bot trigger) and before Side B can integrate real OTP-read/live-handoff flows against anything other than fixtures.
- **Side B** (see `08-workflow-side-b.md`): not started; blocked on the mock Handshake site and Side A's A5 workflow skeleton.

`.mdc` rules breakdown: **warranted**. Four distinct areas with different conventions (RN app, Playwright bot, Vercel Workflows, Supabase schema) — create `app.mdc`, `bot-playwright.mdc`, `workflows.mdc`, `supabase.mdc` alongside root `AGENTS.md` for Antigravity CLI (agy) to pick up.

---

## Phase 0 — One-time developer setup (manual, not Antigravity CLI (agy))
Neither of these can be self-registered by the app or the bot — both require a human doing a one-time manual step before Phase 1 code can be tested.
- **Telegram bot**: message @BotFather → `/newbot` → get bot token → store as `TELEGRAM_BOT_TOKEN` in Vercel env vars.
- **Google OAuth client**: create a Google Cloud project → configure OAuth consent screen → set publishing status to **Testing** → add your test-account email(s) to the allowlist → generate OAuth Client ID + secret → store as `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` in Vercel env vars.
Both are app-level secrets, set once, never collected from or exposed to end users.

## Phase 1 — Supabase schema + minimal onboarding
- **Goal:** onboarding form writes a complete, valid profile + resume to Supabase.
- **Files/modules:** Supabase migrations for all `05-backend-schema.md` tables + RLS policies (including `gmail_oauth_tokens`); RN onboarding screen; `/api/onboarding` route; Telegram bot registration (BotFather, single app-level token in env) + `/api/telegram/webhook` link-capture; Google Cloud OAuth client (readonly Gmail scope, "Testing" publishing status, test accounts allowlisted) + `/api/oauth/gmail/start` + `/api/oauth/gmail/callback`.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — draft migration SQL from `05-backend-schema.md` verbatim. (2) Agent mode — apply migrations, generate RLS policies (confirm `gmail_oauth_tokens` blocks client-role reads). (3) Plan mode — draft onboarding screen field list from `04-ui-ux.md`, including the Telegram link button and the (now unconditional, shown to all users) Gmail OAuth button. (4) Agent mode — build screen + API route + resume upload to Storage. (5) Agent mode — build Telegram link-capture webhook. (6) Agent mode — build Gmail OAuth start/callback, encrypted token storage.
- **Checkpoint:** Given a filled form with a valid resume, when submitted, then a `profiles` row + `resumes` row exist, RLS blocks cross-user reads, `telegram_chat_id` is populated after linking, and `gmail_oauth_tokens` holds an encrypted refresh token for every submitted profile (not just existing-account users).
- **Docs automation:** confirm the AGENTS.md end-of-slice rule fired (README/docstrings updated) before moving on.
- **Git:** branch `phase-1-onboarding`, commit at checkpoint pass.
- **OSS libs:** `@supabase/supabase-js`, RN form/validation lib of Antigravity CLI (agy)'s choice (keep minimal, no paid UI kit).
- **Status:** ✅ complete.

## Phase 1.5 — Mock Handshake test site
- **Goal:** stand up a mock Handshake site so bot flows can be built and tested without a real Handshake account or a real student email inbox.
- **Files/modules:** `/mock-handshake` routes on the same Vercel deployment. Signup flow pages: email entry → school dropdown → SSO/set password (this is the live-handoff trigger point, mirroring real Handshake's email-verification pause) → onboarding questions → done. Apply flow: a job page with Quick Apply/Apply buttons, document upload, and screening questions. OTP emails for the login branch sent from `portgasdiscordace@gmail.com` so `readOtpFromGmail` can be tested against a real inbox.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — outline `/mock-handshake` routes and pages against `03-workflow.md`'s auth and apply steps. (2) Agent mode — build the signup flow pages (email → school dropdown → SSO/set password → onboarding questions → done). (3) Agent mode — build the apply flow page (Quick Apply/Apply, document upload, screening questions). (4) Agent mode — wire the OTP test-email sender (`portgasdiscordace@gmail.com`). (5) Plan mode — audit every mock-page selector against the real Handshake DOM structure to confirm parity.
- **Checkpoint:** Given the mock signup flow, when run end-to-end (email entry → school dropdown → SSO/set password → onboarding questions → done), then it pauses for live handoff at the SSO/set-password step exactly as real Handshake would, an OTP email arrives from `portgasdiscordace@gmail.com` on the login path, and every DOM selector matches real Handshake's structure so Side B's bot code needs no branching between mock and real targets.
- **Docs automation:** end-of-slice update.
- **Git:** branch `mock-handshake-site`, commit at checkpoint pass.
- **OSS libs:** none new (same Vercel deployment).
- **Status:** next up — build this before starting Phase 2 (Side A5) so Side A5/A6 and Side B's phases can integrate against a live target instead of fixtures only.

## Phase 2 — Handshake authenticate step (isolated)
- **Goal:** `authenticate` workflow step works standalone (no apply logic yet) for both branches.
- **Files/modules:** `handshakeBotWorkflow` skeleton (`'use workflow'`), `createAccount` step, `otpLogin` step, Gmail readonly OAuth integration, live-handoff pause/resume hook.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — outline the two auth branches against `03-workflow.md` step-by-step. (2) Agent mode — build `createAccount` step through the "Maybe later" network prompt to the live-handoff pause. (3) Agent mode — build the live-handoff resume hook (`/api/bot/live-handoff/resume`). (4) Agent mode — build `otpLogin` step + Gmail readonly OTP read, using the stored refresh token from `gmail_oauth_tokens` (Phase 1, now collected from every user) — fail fast with a clear error if a Yes-branch user has no token on file. (5) Fresh Antigravity CLI (agy) session — test each branch independently against the mock Handshake site (Phase 1.5) before touching apply logic.
- **Checkpoint:** Given a profile with `has_existing_handshake_account = false`, when the workflow runs, then it pauses at live handoff and resumes correctly after signal. Given `= true`, when it runs, then OTP is read and login completes with no live handoff.
- **Docs automation:** end-of-slice update.
- **Git:** branch `phase-2-auth`, commit at each branch passing independently.
- **OSS libs:** `playwright-core`, `@sparticuz/chromium`, `googleapis` (Gmail readonly).
- **Status:** not started.

## Phase 3 — Apply step
- **Goal:** given an authenticated session + job link, bot completes and submits an application.
- **Files/modules:** `applyToJob` step — Quick Apply/Apply detection, "Upload new" resume attach, reusable-answers lookup, `bot_runs` write.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — outline Quick Apply vs Apply decision logic + document-upload logic from `03-workflow.md`. (2) Agent mode — build detection + resume attach. (3) Agent mode — build reusable-answers lookup against Supabase before any Telegram fallback exists (stub the fallback for now).
- **Checkpoint:** Given a job link with Quick Apply available, when the step runs, then Quick Apply is used and the resume is attached via "Upload new," not a dropdown pick.
- **Docs automation:** end-of-slice update.
- **Git:** branch `phase-3-apply`, commit at checkpoint pass.
- **OSS libs:** none new.
- **Status:** not started.

## Phase 4 — Telegram fallback
- **Goal:** missing document/answer during apply triggers Telegram, reply resumes the workflow and persists for reuse.
- **Files/modules:** Telegram bot setup, `/api/telegram/webhook`, write-through to `reusable_answers`/`documents`.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — map the pause/notify/resume sequence. (2) Agent mode — build webhook + Supabase write + workflow resume signal.
- **Checkpoint:** Given an unanswered application question, when the bot pauses and the user replies in Telegram, then the answer fills the field, the run resumes, and a second run with the same question skips Telegram entirely.
- **Docs automation:** end-of-slice update.
- **Git:** branch `phase-4-telegram`, commit at checkpoint pass.
- **OSS libs:** `node-telegram-bot-api` or Telegram's raw Bot API via `fetch`.
- **Status:** not started.

## Phase 5 — Live handoff hardening + safe exit
- **Goal:** the live-handoff view is reliable end-to-end and every run — success or failure — exits the browser session cleanly.
- **Files/modules:** live-view embedding in RN, session-loss handling, explicit `safeExit` step at the end of every branch.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — enumerate every point in `03-workflow.md` that must reach `safeExit`, including failure paths. (2) Agent mode — implement `safeExit` as the terminal step in all branches. (3) Agent mode — build/harden the RN live-view embed.
- **Checkpoint:** Given any failure mid-run (bad selector, missing job listing, rate limit hit), when the run ends, then no browser session is left open and `bot_runs.status` reflects the true outcome.
- **Docs automation:** end-of-slice update.
- **Git:** branch `phase-5-handoff-exit`, commit at checkpoint pass.
- **OSS libs:** whatever RN remote-view approach Antigravity CLI (agy) proposes — confirm license is free before adopting.
- **Status:** not started.

## Phase 6 — Daily report
- **Goal:** cron-triggered summary email.
- **Files/modules:** `/api/reports/daily`, Vercel Cron config, Resend integration.
- **Antigravity CLI (agy) prompt order:** (1) Plan mode — outline report content from `01-prd.md` success metrics. (2) Agent mode — build query + Resend send + cron config.
- **Checkpoint:** Given at least one `bot_runs` row from today, when the cron fires, then a report email arrives with an accurate count and status breakdown.
- **Docs automation:** end-of-slice update.
- **Git:** branch `phase-6-daily-report`, commit at checkpoint pass, merge all phase branches to `main`.
- **OSS libs:** `resend` SDK.
- **Status:** not started.

---

## Model assignments (Side A phases, see `07-workflow-side-a.md`)
| Phase | Focus | Model |
|---|---|---|
| A1 | Supabase schema + RLS (security/auth) | Claude Sonnet 4.6 Thinking |
| A2 | Onboarding screen + resume upload (moderate logic) | Gemini Flash High |
| A3 | Telegram linking infra (CRUD/UI) | Gemini Flash Medium |
| A4 | Gmail OAuth + OTP read (security/auth) | Claude Sonnet 4.6 Thinking |
| A5 | Workflow skeleton + bot trigger (orchestration) | Claude Sonnet 4.6 Thinking |
| A6 | Live handoff, app-side (moderate logic) | Gemini Flash High |
| A7 | Telegram fallback + rate limit (moderate logic) | Gemini Flash High |
| A8 | Bot Status screen (CRUD/UI) | Gemini Flash Medium |
| A9 | Daily report (CRUD/UI) | Gemini Flash Medium |

## Antigravity CLI (agy) usage notes (all phases)
Cursor Pro remains the only paid tool/subscription on this project; Antigravity CLI (agy) is the active code-generation agent used for the prompt orders above.
- **Plan mode** for every step outline above before touching code — no exceptions, even for small phases.
- **Agent mode** only after reviewing the plan diff.
- **Fresh chat/context** at the start of each phase, and immediately after Phase 2 (auth) since it's the highest-risk, most exploratory phase — don't let debugging context bleed into Phase 3.
- Self-run tests + diff review before every commit; commits map 1:1 to the checkpoints above.
