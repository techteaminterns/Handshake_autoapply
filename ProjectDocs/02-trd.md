# TRD — Handshake Auto-Apply Bot (MVP)

## Architecture Overview
Single Vercel deployment (TypeScript throughout) hosting: the API routes the RN app calls, and the Vercel Workflows that run the Playwright bot. Supabase is the system of record (auth, Postgres, Storage, RLS) and the source of onboarding/reuse data. All bot execution is modeled as durable Vercel Workflow steps so it can pause indefinitely (live handoff, OTP wait, Telegram wait) without holding a live function open. No separate worker, no external queue, no n8n.

**Stack:** React Native (Expo) · Supabase (Postgres/Auth/Storage/RLS) · Vercel Functions + Vercel Workflows · Playwright + `@sparticuz/chromium` · Telegram Bot API · Gmail API (readonly) · Resend

## Tech Stack

| Layer | Tool | Reason |
|---|---|---|
| Frontend | React Native (Expo) | Team default; fastest path to a minimal onboarding form |
| Backend/DB/Auth | Supabase | Free tier, RLS, Storage for resumes, single default per project standards |
| API + orchestration | Vercel Functions | Single deploy target per this phase's constraint |
| Durable execution | Vercel Workflows | Native pause/resume for minutes–months; replaces external queue (Upstash) or n8n |
| Browser automation | Playwright + `@sparticuz/chromium` | Fits Vercel's 250MB function bundle limit; team already committed to Playwright |
| Scheduled trigger | Vercel Cron | Fixed-schedule daily report only — Workflows handle everything reactive |
| Missing doc/answer capture | Telegram Bot API | Free, real-time, simple webhook integration |
| OTP read | Gmail API (readonly OAuth scope) | Automates Handshake login without storing email credentials |
| Transactional email | Resend | Free tier, clean TS SDK, pairs well with Vercel |

## System Components
- **Onboarding API** — writes form answers + resume to Supabase; validates .edu email format.
- **Bot Trigger API** — fires on job-link submission; starts the `handshakeBotWorkflow`.
- **`handshakeBotWorkflow`** (Vercel Workflow) — steps: `authenticate` (branches: `createAccount` vs `otpLogin`) → `applyToJob` → `safeExit`. Each step is a Playwright run scoped to fit Hobby's 300s function duration; waits between steps use workflow `sleep`/hooks, not in-function polling.
- **Live Handoff channel** — exposes the bot's current Playwright session to the RN app for a live view; a workflow hook resumes the run once the user signals completion.
- **Telegram Fallback service** — webhook receives missing document/answer, writes it to Supabase, resumes the paused workflow step.
- **Reusable Answers Store** — Supabase table of prior Q&A/document mappings, checked before ever prompting the user again.
- **Daily Report job** — Vercel Cron → queries Supabase for the day's applications → sends via Resend.
- **Mock Handshake test site** — `/mock-handshake` routes on the same Vercel deployment, standing in for real Handshake during bot development/testing so the flow can be exercised without a real Handshake account or a real student email inbox. Signup flow: email entry → school dropdown → SSO/set password (this is where **live handoff** triggers) → onboarding questions → done. Apply flow: a job page with Quick Apply/Apply buttons, document upload, and screening questions. OTP test emails are sent from `portgasdiscordace@gmail.com` so `readOtpFromGmail` can be exercised against a real inbox. DOM selectors on every mock page mirror real Handshake's exactly, so Side B's Playwright code works unmodified against both the mock site and real Handshake.

## APIs / Integrations
- **Gmail API (readonly)** — per-user OAuth consent, requested from every user during onboarding regardless of `has_existing_handshake_account`. Restricted scope: this phase runs in Google's "Testing" publishing status with allowlisted test accounts, avoiding formal verification. Refresh tokens stored encrypted, service-role read only, never exposed to the client.
- **Telegram Bot API** — single app-level bot token (env secret), not per-user. Each user links their own Telegram via a deep-link "start" flow that captures their `chat_id`; the bot then messages that `chat_id` for missing docs/answers.
- Resend API — outbound email only.
- No Handshake API (none exists) — browser automation only.

## Non-functional requirements
- **Performance:** individual bot steps must complete within 300s (Hobby function max duration); long waits (user action, OTP, Telegram) live at the workflow level via `sleep`/hooks, not inside a running function.
- **Scale:** single-user test volume this phase; rate limit hard-capped at 300 bot actions/day per PRD.
- **Security:** RLS on every Supabase table with personal data, credentials, resumes, or Q&A history. No Handshake or email credentials stored in plaintext — OTP flow uses readonly OAuth, not password storage, wherever possible.

## Background/unattended execution needs
Needed, and handled entirely by **Vercel Workflows** — no n8n, no Hermes Agent, no external queue. Justification: the only unattended/long-wait requirements this phase are (1) waiting on live-handoff user action, (2) waiting on Telegram reply, (3) waiting on Gmail OTP arrival, (4) the daily cron report. Workflows durable pause/resume covers 1–3 natively; Vercel Cron covers 4. Evaluate a heavier tool only if a later phase adds true multi-agent parallelism (e.g. many jobs applied concurrently across many users).

## Key technical risks
| Risk | Mitigation this phase |
|---|---|
| Handshake ToS likely prohibits automated account creation/applying | Hard 300/day action cap; documented, not solved |
| Chromium binary must fit 250MB Vercel bundle limit | Use `@sparticuz/chromium`, not full Playwright-bundled Chromium; verify bundle size in CI before each deploy |
| Handshake DOM changes break selectors | No mitigation this phase; flag as ongoing maintenance cost |
| Live-handoff UX (embedding a remote browser view in RN) is the least-proven piece of this stack | Build and test in isolation (Phase 5) before wiring into the full flow |
| Single combined trigger (job link submit → auth + apply) makes failures hard to isolate during testing | Implementation plan tests `authenticate` and `applyToJob` as independently runnable steps before wiring the combined trigger |
| `gmail.readonly` is a Google restricted scope | Stay in Google OAuth "Testing" status with allowlisted testers this phase; verification/CASA assessment deferred until real production rollout |
