# Workflow — Side A (Everything except Playwright)

**Owns:** Supabase schema/RLS, RN app, onboarding extension, monitoring UI, Telegram infra, intervention system, Side A interface functions, local worker loop orchestration, Vercel Workflows migration (last phase).
**Does not own:** any Playwright code, any Handshake page interaction. Side B owns that entirely.

---

## Interface Contract

Functions **Side A implements, Side B calls:**
| Function | Purpose |
|---|---|
| `getProfile(profileId)` | Returns normalized profile for filling Handshake forms |
| `getResumeUrl(profileId)` | Supabase Storage signed URL for resume |
| `claimNextJob(profileId, workerId)` | Atomically claims next APPROVED+QUEUED application; returns row or null |
| `markJobStatus(applicationId, status, reason?)` | Updates applications.status + writes application_event |
| `createIntervention(profileId, type, applicationId?, questionText?, options?)` | Creates OPEN intervention row; returns interventionId |
| `resolveIntervention(interventionId, timeoutMs?)` | Polls until RESOLVED; returns answer string |
| `storeJobsFromScrape(profileId, jobs[])` | Upserts to handshake_jobs; deduplicates by URL; returns new job count |
| `checkAndIncrementActionCount(profileId)` | Returns false if 300/day cap hit; else increments and returns true |

Functions **Side B implements, Side A's worker calls:**
| Function | Purpose |
|---|---|
| `runSignIn(profile)` | Full Handshake sign-in flow |
| `runSignUp(profile)` | Full Handshake sign-up + onboarding flow |
| `checkSessionHealth(profile)` | Returns true if logged in |
| `runScrape(profile, preferences)` | Scrapes Handshake jobs; returns normalized array |
| `runApplyToJob(jobUrl, profile, applicationId)` | Full apply flow |
| `safeExit(browserSession)` | Closes browser cleanly |

Until real Side B function exists, build against a stub returning fixture data.

## Sync Points
- **Before B1 integrates:** `getProfile` (A5) and `createIntervention`/`resolveIntervention` (A5) must be real
- **Before B4 integrates:** `storeJobsFromScrape` (A5) must be real
- **Before B5 integrates:** `getResumeUrl`, `checkAndIncrementActionCount` (A5) must be real
- **Major sync — Integration pass:** sit together, swap every stub, run full flow live

## Branching & PR Conventions
- Branch naming: `side-a/v1-phase{N}-<short-name>`
- Commit at every checkpoint pass
- PR into `main`; paste checkpoint Given/When/Then and confirm it passes
- Request Side B review before merging
- Squash-merge, delete branch after merge
- Never merge a phase whose checkpoint hasn't been self-tested

---

## Phase V1-A1 — Schema migration
- **Goal:** all new V1 tables + profile alterations + RLS + atomic claim RPC in Supabase
- **Cursor prompt order:**
  1. Plan mode — `@05-backend-schema.md Draft migration SQL for all new V1 tables, profile alterations, indexes, status constraints, and claim_next_job RPC.`
  2. Agent mode — apply migrations + RLS policies
  3. Plan mode — confirm `handshake_password_enc` service-role only; confirm RPC uses FOR UPDATE SKIP LOCKED
  4. Agent mode — fix if not
- **Checkpoint:** RLS blocks cross-user reads on all new tables. Simultaneous claim_next_job calls: exactly one succeeds.
- **Git:** `side-a/v1-phase1-schema`

## Phase V1-A2 — Extend onboarding
- **Goal:** onboarding screen + API handle new Handshake account fields
- **Cursor prompt order:**
  1. Plan mode — `@04-ui-ux.md @05-backend-schema.md Draft new onboarding fields and API changes.`
  2. Agent mode — extend `OnboardingScreen.js` + `/api/onboarding`
- **Checkpoint:** Submitted form with has_existing_handshake_account=true writes both new fields; handshake_password_enc never in API response.
- **Git:** `side-a/v1-phase2-onboarding`

## Phase V1-A3 — Monitoring UI
- **Goal:** monitoring UI screen in RN app with live Supabase data + intervention popup
- **Cursor prompt order:**
  1. Plan mode — `@04-ui-ux.md Draft monitoring UI: all sections, states, popup types.`
  2. Agent mode — build screen with mock data
  3. Agent mode — wire Supabase Realtime subscriptions
  4. Agent mode — build intervention popup (all 4 types) + `/api/interventions/:id/resolve`
- **Checkpoint:** OPEN intervention row → popup appears without refresh. Resolved → popup auto-dismisses.
- **Git:** `side-a/v1-phase3-monitoring-ui`

## Phase V1-A4 — Telegram job confirmation
- **Goal:** new jobs trigger Telegram yes/no; replies create/update application rows
- **Cursor prompt order:**
  1. Plan mode — outline yes/no matching logic (one pending job per user at a time)
  2. Agent mode — extend `/api/telegram/webhook`; build send utility; create/update application rows
- **Checkpoint:** yes reply → QUEUED application created. no reply → REJECTED application created. Duplicate reply ignored.
- **Git:** `side-a/v1-phase4-telegram-confirmation`

## Phase V1-A5 — Interface functions
- **Goal:** all 8 Side A functions are real and tested in isolation
- **Cursor prompt order:**
  1. Plan mode — list each function, DB query, return shape
  2. Agent mode — implement all in `sideA.js`; `resolveIntervention` polls every 2s, timeout configurable
- **Checkpoint:** Each function returns correct shape. `claimNextJob` called twice simultaneously: one row, one null.
- **Git:** `side-a/v1-phase5-interface-functions` — **tell Side B this merged**

## Phase V1-A6 — Local worker loop
- **Goal:** Node.js worker runs health check (30min), daily scrape, and sequential apply loop
- **Cursor prompt order:**
  1. Plan mode — `@worker.mdc Outline worker: health tick, scrape tick, apply loop with atomic claim and sequential processing.`
  2. Agent mode — build with Side B stubs
  3. Agent mode — wire real Side B functions after B3/B4/B5 merged
- **Checkpoint:** Worker starts cleanly. Health check fires on interval. Apply loop processes one job at a time, does not start second until first is terminal.
- **Git:** `side-a/v1-phase6-worker-loop`

## Phase V1-A7 — Vercel Workflows migration [may slip to V2]
- **Goal:** replace local worker with Vercel Workflows durable execution
- **Cursor prompt order:**
  1. Plan mode — `@workflows.mdc Map health/scrape/apply loops to Workflow steps with sleep/hook pauses.`
  2. Agent mode — migrate
- **Checkpoint:** Worker loop runs on Vercel. Intervention pause/resume works without local process.
- **Git:** `side-a/v1-phase7-vercel-workflows`
