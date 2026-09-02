# TRD — OneClickHandshake V1

## Architecture Overview
RN/Expo app handles auth, onboarding, and monitoring UI. Vercel hosts API routes. Supabase is source of truth. A local Node.js worker process runs the bot loop (session health, scrape trigger, apply execution). Side B owns all Playwright code; Side A owns everything else. Telegram handles job confirmation (yes/no). OTPs and confirmations are handled via popup in the monitoring UI, which polls Supabase interventions table.

**Stack:** React Native (Expo) · Supabase (Postgres/Auth/Storage/RLS) · Vercel Functions · Local Playwright (playwright-core) · Telegram Bot API · Cursor Pro (code generation)

## Tech Stack

| Layer | Tool | Reason |
|---|---|---|
| Frontend | React Native (Expo) | Existing; auth + onboarding + monitoring UI |
| Backend/DB/Auth | Supabase | Existing; RLS, Storage, Realtime |
| API routes | Vercel Functions | Existing deployment target |
| Bot execution | Local Playwright (playwright-core) | No Browserless.io until reliability proven |
| Worker loop | Local Node.js process | Runs session health + scrape + apply loop |
| Job confirmation | Telegram Bot API | Existing infra; yes/no per job |
| OTP/intervention | Supabase Realtime + RN popup | Monitoring UI polls interventions table |
| Durable execution | Vercel Workflows | Last phase only; may slip to V2 |

## System Components

- **Extended Onboarding API** — upserts profile with all preferences + Handshake account flag to Supabase
- **Worker loop** — Node.js process; 30-min session health check, daily scrape trigger, sequential apply loop
- **Scraper** (Side B) — Playwright; scrapes Handshake jobs filtered by user prefs; stores to `handshake_jobs`
- **Session health check** (Side B) — Playwright; checks if bot is logged into Handshake; writes to `browser_profiles`
- **Sign-in flow** (Side B) — Playwright; logs into Handshake; OTP received via `interventions` table resolution
- **Sign-up flow** (Side B) — Playwright; creates Handshake account; email confirm + phone OTP via `interventions`
- **Apply state machine** (Side B) — Quick Apply preferred → resume upload → form fill → submit → DOM verify
- **Telegram job confirmation** — bot sends job details; user replies yes/no; yes → mark APPROVED, no → REJECTED
- **Interventions system** — Side A creates OPEN intervention row; monitoring UI popup shows it; user submits answer; Side B polls for RESOLVED
- **Monitoring UI** — RN screen; job queue table, bot status, OTP/confirmation popups via Realtime subscription
- **Atomic queue claim RPC** — Supabase RPC; atomically claims one QUEUED application to prevent races

## APIs / Integrations

- **Telegram Bot API** — job confirmation (yes/no); existing send/receive utilities reused
- **Supabase Realtime** — monitoring UI subscribes to `interventions` + `applications` for live updates
- No Gmail OAuth, no Resend, no Browserless.io in V1

## Interface Contract (Side A implements, Side B calls)

| Function | Purpose |
|---|---|
| `getProfile(profileId)` | Returns normalized user profile for filling Handshake forms |
| `getResumeUrl(profileId)` | Supabase Storage URL for resume |
| `claimNextJob(profileId)` | Atomically claims next APPROVED+QUEUED application; returns null if none |
| `markJobStatus(applicationId, status, reason?)` | Updates applications.status |
| `createIntervention(applicationId, type, questionText?, options?)` | Creates OPEN intervention row |
| `resolveIntervention(interventionId)` | Polls until RESOLVED; returns answer |
| `storeJobsFromScrape(jobs[])` | Upserts scraped jobs to handshake_jobs; deduplicates |
| `checkAndIncrementActionCount(profileId)` | Rate limit check (300 actions/day) |

## Interface Contract (Side B implements, Side A calls)

| Function | Purpose |
|---|---|
| `runSignIn(profile)` | Full Handshake sign-in flow |
| `runSignUp(profile)` | Full Handshake sign-up + onboarding flow |
| `checkSessionHealth(profile)` | Returns true if logged in, false if not |
| `runScrape(profile, preferences)` | Scrapes Handshake jobs; returns normalized job list |
| `runApplyToJob(jobUrl, profile, applicationId)` | Full apply flow |
| `safeExit(browserSession)` | Closes browser session cleanly |

## Non-functional Requirements

- **Performance:** each bot action must not block the worker loop; interventions pause execution, not the process
- **Scale:** single user V1; atomic claim RPC designed for future multi-user without rewrite
- **Security:** RLS on all tables; no credentials in plaintext; resume URLs service-role only
- **Reliability:** safeExit on every path; SUBMITTED only after DOM verification; no silent failures

## Background/Unattended Execution

Local Node.js worker process running on laptop:
- Every 30 mins: calls `checkSessionHealth` → if false, creates AUTH intervention
- Once per day: calls `runScrape` → stores jobs → sends Telegram yes/no per new job
- Continuously: polls for APPROVED applications → claims one → runs apply → loops

Vercel Workflows replaces this local process in the final V1 phase.

## Key Technical Risks

| Risk | Mitigation |
|---|---|
| Handshake jobs page may require login to scrape | Confirm once student email obtained; Side B builds scraper with authenticated session as default |
| Handshake DOM changes break selectors | No mitigation V1; flagged as ongoing maintenance |
| Student email delayed | Build everything DB/app-side first; bot phases use mock Handshake until real account available |
| Local worker process reliability (laptop off = bot stops) | Accepted for V1; Vercel Workflows migration is final phase |
| Vercel Workflows migration complexity | Explicitly may slip to V2; local worker is the fallback |
