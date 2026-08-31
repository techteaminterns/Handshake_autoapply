# Implementation Plan — OneClickHandshake V1

`.cursor/rules/` breakdown: **warranted** — update existing `app.mdc`, `bot-playwright.mdc`, `supabase.mdc`; add `worker.mdc` for the local worker loop. Remove `workflows.mdc` until Vercel Workflows phase.

All code generation: **Cursor Pro** (Agent mode after Plan mode review).

---

## Phase V1-A1 — Schema migration + profile extension (Side A)
- **Goal:** new V1 tables exist in Supabase with RLS; profiles table extended
- **Files:** new migration SQL for `handshake_jobs`, `applications`, `application_events`, `interventions`, `browser_profiles`; ALTER on `profiles` for `has_existing_handshake_account`, `handshake_email`, `handshake_password_enc`; atomic claim RPC
- **Cursor prompt order:**
  1. Plan mode — `@05-backend-schema.md Draft migration SQL for all new V1 tables, profile alterations, indexes, status constraints, and the claim_next_job RPC.`
  2. Agent mode — apply migrations, generate RLS policies
  3. Plan mode — confirm `handshake_password_enc` is service-role only; confirm atomic RPC uses FOR UPDATE SKIP LOCKED
  4. Agent mode — fix if not
- **Checkpoint:** Given any new table queried as a different user's session, RLS blocks the read. Given two simultaneous claim_next_job calls, exactly one gets the row.
- **Docs:** confirm AGENTS.md end-of-slice rule fired
- **Git:** branch `side-a/v1-phase1-schema`, commit + PR at checkpoint pass

## Phase V1-A2 — Extend onboarding screen + API (Side A)
- **Goal:** onboarding stores has_existing_handshake_account, handshake_email to DB; existing fields unaffected
- **Files:** `OnboardingScreen.js` (add Yes/No toggle + conditional handshake_email field); `/api/onboarding` (handle new fields, encrypt + store handshake_password_enc if provided)
- **Cursor prompt order:**
  1. Plan mode — `@04-ui-ux.md @05-backend-schema.md Draft the new onboarding fields and API changes.`
  2. Agent mode — extend screen + API
- **Checkpoint:** Given onboarding form submitted with has_existing_handshake_account = true and handshake_email filled, profiles row contains both fields; handshake_password_enc is never returned to client.
- **Docs:** confirm
- **Git:** branch `side-a/v1-phase2-onboarding`, commit + PR

## Phase V1-A3 — Monitoring UI screen (Side A)
- **Goal:** monitoring UI screen exists in RN app with live data from Supabase
- **Files:** `MonitoringScreen.js`; Supabase Realtime subscriptions on `applications` + `interventions`; `/api/applications`; `/api/interventions/open`
- **Cursor prompt order:**
  1. Plan mode — `@04-ui-ux.md Draft the monitoring UI screen: header, stats row, current job card, step progress, queue table, Telegram status line, intervention popup.`
  2. Agent mode — build screen with mock data first
  3. Agent mode — wire Supabase Realtime subscriptions
  4. Agent mode — build intervention popup component (all 4 types); wire to `/api/interventions/:id/resolve`
- **Checkpoint:** Given an OPEN intervention row in DB, when monitoring UI is open, popup appears without page refresh. Given intervention resolved, popup auto-dismisses.
- **Docs:** confirm
- **Git:** branch `side-a/v1-phase3-monitoring-ui`, commit + PR

## Phase V1-A4 — Telegram job confirmation (Side A)
- **Goal:** when new job added to queue, Telegram message sent; yes/no reply creates/updates application row
- **Files:** extend `/api/telegram/webhook` to handle yes/no replies; job confirmation send utility; match reply to pending job
- **Cursor prompt order:**
  1. Plan mode — outline yes/no reply matching logic (which job is "pending" for this user at reply time)
  2. Agent mode — build send + receive + application row create/update
- **Checkpoint:** Given a new handshake_job row and Telegram yes reply, application row created as QUEUED. Given no reply, nothing created. Given no reply, job marked REJECTED.
- **Docs:** confirm
- **Git:** branch `side-a/v1-phase4-telegram-confirmation`, commit + PR

## Phase V1-A5 — Side A interface functions (Side A)
- **Goal:** all functions Side B calls are real (not stubs)
- **Files:** `sideA.js` — `getProfile`, `getResumeUrl`, `claimNextJob`, `markJobStatus`, `createIntervention`, `resolveIntervention`, `storeJobsFromScrape`, `checkAndIncrementActionCount`
- **Cursor prompt order:**
  1. Plan mode — list each function, its DB query, and return shape per `05-backend-schema.md`
  2. Agent mode — implement all; `resolveIntervention` polls interventions table on 2s interval until RESOLVED or timeout
- **Checkpoint:** Each function callable in isolation returns correct shape. `claimNextJob` called twice simultaneously returns one row and one null.
- **Docs:** confirm
- **Git:** branch `side-a/v1-phase5-interface-functions`, commit + PR. **Tell Side B — unblocks real integration.**

## Phase V1-B0 — Playwright environment setup (Side B)
- **Goal:** local Playwright can launch and screenshot Handshake (or mock) page
- **Files:** bot/ scaffold; playwright-core install; throwaway launch script
- **Cursor prompt order:**
  1. Plan mode — `@bot-playwright.mdc Set up playwright-core for local execution with persistent browser context support.`
  2. Agent mode — install, write launch script
- **Checkpoint:** Script runs, screenshots a page, persistent context directory created.
- **Git:** branch `side-b/v1-phase0-setup`, commit + PR

## Phase V1-B1 — Sign-in flow (Side B)
- **Goal:** `runSignIn(profile)` logs into Handshake; OTP received via stubbed `resolveIntervention`
- **Files:** `bot/signin.js`
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md Outline sign-in flow step by step including OTP intervention pause.`
  2. Agent mode — build flow with stubbed `createIntervention` + `resolveIntervention`
  3. Agent mode — wrap all exits with `safeExit`
- **Checkpoint:** Given fixture profile and stubbed OTP "123456", bot fills login form, "receives" OTP, submits. **Test against mock Handshake until real student email available.**
- **Git:** branch `side-b/v1-phase1-signin`, commit + PR

## Phase V1-B2 — Sign-up flow (Side B)
- **Goal:** `runSignUp(profile)` creates Handshake account; email confirm + phone OTP via stubbed interventions
- **Files:** `bot/signup.js`
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md Outline sign-up flow including email confirm pause and phone OTP pause.`
  2. Agent mode — build; stub both interventions
  3. Agent mode — safeExit on all paths
- **Checkpoint:** Given fixture profile, bot fills signup form, custom password set, pauses at email confirm stub, pauses at phone OTP stub, continues.
- **Git:** branch `side-b/v1-phase2-signup`, commit + PR

## Phase V1-B3 — Session health check (Side B)
- **Goal:** `checkSessionHealth(profile)` returns true/false based on Handshake DOM
- **Files:** `bot/sessionHealth.js`
- **Cursor prompt order:**
  1. Plan mode — identify DOM element that confirms logged-in state on Handshake
  2. Agent mode — build check; return bool; safeExit
- **Checkpoint:** Given logged-in session, returns true. Given logged-out, returns false.
- **Git:** branch `side-b/v1-phase3-session-health`, commit + PR

## Phase V1-B4 — Scraper (Side B)
- **Goal:** `runScrape(profile, preferences)` returns normalized job list from Handshake
- **Files:** `bot/scraper.js`
- **Note:** blocked until student email obtained to confirm if login required. Build with authenticated session as default assumption.
- **Cursor prompt order:**
  1. Plan mode — outline scrape: login check → apply preference filters → paginate → normalize (url, title, company, location, has_quick_apply)
  2. Agent mode — build; call `storeJobsFromScrape` at end
- **Checkpoint:** Given logged-in session and preferences, returns array of normalized job objects. Dedup verified (same URL not returned twice).
- **Git:** branch `side-b/v1-phase4-scraper`, commit + PR

## Phase V1-B5 — Apply state machine (Side B)
- **Goal:** `runApplyToJob(jobUrl, profile, applicationId)` completes full apply flow
- **Files:** `bot/apply.js`
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md @bot-playwright.mdc Outline apply state machine: open_job → check_login → quick_apply → resume → questions → submit → verify.`
  2. Agent mode — build Quick Apply / Apply detection (Quick Apply always wins)
  3. Agent mode — resume upload ("Upload new" always, never dropdown)
  4. Agent mode — per-question loop: check profile → auto-fill or `createIntervention` → `resolveIntervention` → fill
  5. Agent mode — submit + DOM verify + `markJobStatus`
  6. Agent mode — safeExit on all paths
- **Checkpoint:** Given mock Handshake job with Quick Apply, resume attaches via "Upload new," unknown question triggers stubbed intervention, submit succeeds, SUBMITTED written only after DOM confirmation.
- **Git:** branch `side-b/v1-phase5-apply`, commit + PR

## Phase V1-A6 — Local worker loop (Side A)
- **Goal:** Node.js worker process runs session health (30min), daily scrape, and apply loop
- **Files:** `worker/index.js`; `worker/healthLoop.js`; `worker/scrapeLoop.js`; `worker/applyLoop.js`
- **Cursor prompt order:**
  1. Plan mode — `@worker.mdc Outline worker: 30min health tick, daily scrape tick, continuous apply loop with atomic claim.`
  2. Agent mode — build with stubs for Side B functions
  3. Agent mode — wire real Side B functions once B3/B4/B5 merged
- **Checkpoint:** Worker starts, health check fires on 30min interval (verified with short test interval), apply loop claims one job and processes it sequentially.
- **Git:** branch `side-a/v1-phase6-worker-loop`, commit + PR

## Phase V1-INT — Integration pass (Both sides)
- **Goal:** every stub replaced with real function; one full end-to-end flow works
- **Cursor prompt order:**
  1. Plan mode — list every remaining stub across all phases
  2. Agent mode — replace each with real import
  3. Fresh Cursor chat — run full flow: onboarding → sign-in → scrape → Telegram confirm → apply → SUBMITTED
- **Checkpoint:** Given real Handshake account, full flow completes with bot_runs status = SUBMITTED. Intervention popup fires and resolves correctly.
- **Git:** branch `integration/v1-full-flow`, both sides review together before merge

## Phase V1-A7 — Vercel Workflows migration (Side A) [may slip to V2]
- **Goal:** replace local worker process with Vercel Workflows durable execution
- **Files:** migrate `worker/` to Vercel Workflow steps; `/api/bot/trigger`
- **Cursor prompt order:**
  1. Plan mode — `@workflows.mdc Map each worker loop (health, scrape, apply) to Vercel Workflow steps with sleep/hook pauses.`
  2. Agent mode — migrate
- **Checkpoint:** Worker loop runs on Vercel without laptop; interventions pause workflow correctly; resumes on resolution.
- **Git:** branch `side-a/v1-phase7-vercel-workflows`, commit + PR

---

## Cursor Pro Usage Notes
- **Plan mode** before every phase — no exceptions
- **Agent mode** only after reviewing plan diff
- **Fresh chat** at start of each phase and immediately after V1-INT (highest-risk phase)
- Self-run tests + diff review before every commit

## Docs Automation
AGENTS.md rule covers end-of-slice doc updates. Confirm it fired before moving to next phase.

## Phase Dependencies
- V1-A5 must merge before Side B can do real integration (B phases use stubs until then)
- V1-B3, B4, B5 must merge before V1-A6 worker loop wires real functions
- V1-INT requires all A and B phases merged
- V1-A7 requires V1-INT passing
