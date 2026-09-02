# Workflow — Side B (Playwright / browser automation only)

**Owns:** all Playwright code, all Handshake page interaction — sign-in, sign-up, session health, scraping, apply flow.
**Does not own:** Supabase schema, RN app, Telegram infra, worker orchestration, monitoring UI. Side A owns all of that — you call their functions, you don't build them.

---

## Interface Contract

Functions **Side A implements, you call:**
| Function | Purpose |
|---|---|
| `getProfile(profileId)` | Normalized profile for filling Handshake forms |
| `getResumeUrl(profileId)` | Supabase Storage URL for resume |
| `claimNextJob(profileId, workerId)` | Atomically claims next APPROVED+QUEUED application |
| `markJobStatus(applicationId, status, reason?)` | Updates application status |
| `createIntervention(profileId, type, applicationId?, questionText?, options?)` | Creates OPEN intervention; returns interventionId |
| `resolveIntervention(interventionId, timeoutMs?)` | Polls until user resolves; returns answer string |
| `storeJobsFromScrape(profileId, jobs[])` | Stores scraped jobs to DB |
| `checkAndIncrementActionCount(profileId)` | Rate limit check |

Functions **you implement, Side A's worker calls:**
| Function | Purpose |
|---|---|
| `runSignIn(profile)` | Full Handshake sign-in flow |
| `runSignUp(profile)` | Full Handshake sign-up + onboarding |
| `checkSessionHealth(profile)` | Returns true if logged in |
| `runScrape(profile, preferences)` | Scrapes Handshake; returns normalized job array |
| `runApplyToJob(jobUrl, profile, applicationId)` | Full apply flow |
| `safeExit(browserSession)` | Closes browser cleanly on every exit path |

Until Side A's real function exists, build against a stub returning fixture data — don't block on them.

## Sync Points
- **B1 real integration** needs Side A's `createIntervention` + `resolveIntervention` (A5)
- **B2 real integration** needs same
- **B3 real integration** needs Side A's `getProfile` (A5)
- **B4 real integration** needs `storeJobsFromScrape` (A5)
- **B5 real integration** needs `getResumeUrl`, `checkAndIncrementActionCount`, `createIntervention`, `resolveIntervention` (A5)
- **Integration pass:** sit together, swap all stubs, run full flow live

## Branching & PR Conventions
- Branch naming: `side-b/v1-phase{N}-<short-name>`
- Commit at every checkpoint pass
- PR description: paste checkpoint Given/When/Then + note which stubs remain
- Never merge a phase whose checkpoint hasn't been tested against a real Handshake page (fixture inputs OK, page interaction must be live)
- Request Side A review before merging
- Squash-merge, delete branch

---

## Phase V1-B0 — Environment setup
- **Goal:** local Playwright launches and screenshots a page; persistent context works
- **Cursor prompt order:**
  1. Plan mode — `@bot-playwright.mdc Set up playwright-core for local execution with persistent browser context support.`
  2. Agent mode — install, write throwaway launch script
- **Checkpoint:** Script runs, screenshots produced, persistent context directory created, no bundle size issues.
- **Git:** `side-b/v1-phase0-setup`

## Phase V1-B1 — `runSignIn`
- **Goal:** full Handshake sign-in; OTP via stubbed `resolveIntervention`
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md Outline sign-in: open login page → enter email → wait for OTP → resolveIntervention → enter OTP → submit → verify logged in.`
  2. Agent mode — build flow with stubbed intervention calls
  3. Agent mode — safeExit on all exits
- **Checkpoint:** Given fixture profile and stub returning OTP "123456", bot fills login, "receives" OTP, submits successfully. Test against mock Handshake until real student email available.
- **Git:** `side-b/v1-phase1-signin` — note stubs in PR; integrate after A5 merges

## Phase V1-B2 — `runSignUp`
- **Goal:** full Handshake sign-up; email confirm + phone OTP via stubbed interventions
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md Outline sign-up: fill form → custom password → createIntervention(EMAIL_CONFIRM) → wait resolve → phone number entry → createIntervention(OTP) → wait resolve → continue onboarding screens.`
  2. Agent mode — build; stub both interventions
  3. Agent mode — safeExit on all exits
- **Checkpoint:** Given fixture profile, bot fills signup, pauses at email confirm stub, pauses at phone OTP stub, continues through remaining Handshake onboarding screens.
- **Git:** `side-b/v1-phase2-signup`

## Phase V1-B3 — `checkSessionHealth`
- **Goal:** returns true if Handshake session active, false if not
- **Cursor prompt order:**
  1. Plan mode — identify DOM selector that definitively confirms logged-in state on Handshake home/jobs page
  2. Agent mode — build check; safeExit; return bool
- **Checkpoint:** Logged-in browser context → true. Logged-out → false. No page mutation occurs during check.
- **Git:** `side-b/v1-phase3-session-health` — **tell Side A this merged**

## Phase V1-B4 — `runScrape`
- **Goal:** scrapes Handshake jobs filtered by user preferences; returns normalized array
- **Note:** blocked until student email obtained. Build assuming authenticated session required.
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md Outline scrape: verify session → apply preference filters (job type, location, keywords) → paginate results → normalize each job (url, title, company, location, has_quick_apply).`
  2. Agent mode — build scraper; call `storeJobsFromScrape` with results
- **Checkpoint:** Given logged-in session and preferences fixture, returns normalized array. Same URL not returned twice across calls.
- **Git:** `side-b/v1-phase4-scraper` — **tell Side A this merged**

## Phase V1-B5 — `runApplyToJob`
- **Goal:** full apply state machine from job URL to verified submission
- **State machine:** OPEN_JOB → CHECK_LOGIN → CHECK_QUICK_APPLY → RESUME → QUESTIONS → SUBMIT → VERIFY
- **Cursor prompt order:**
  1. Plan mode — `@03-workflow.md @bot-playwright.mdc Outline apply state machine with all states, transitions, and failure exits.`
  2. Agent mode — Quick Apply / Apply detection (Quick Apply always wins when both present)
  3. Agent mode — resume upload: always "Upload new," never dropdown; use `getResumeUrl`
  4. Agent mode — per-question loop: check profile data → auto-fill if matched → else `createIntervention(UNKNOWN_QUESTION)` → `resolveIntervention` → fill → store answer for reuse
  5. Agent mode — `checkAndIncrementActionCount` before each Handshake action; halt if false
  6. Agent mode — submit → DOM verify success confirmation → `markJobStatus(SUBMITTED)` only after positive verification
  7. Agent mode — safeExit on every exit path; `markJobStatus(FAILED, reason)` on any unrecoverable error
- **Checkpoint:** Given mock Handshake job with Quick Apply: Quick Apply used, resume via "Upload new," unknown question triggers stubbed intervention, SUBMITTED written only after DOM success element found.
- **Git:** `side-b/v1-phase5-apply` — **tell Side A this merged**

## Phase V1-B-INT — Integration pass (both sides)
- **Goal:** all stubs replaced with real Side A functions; one full flow works live
- **Cursor prompt order:**
  1. Plan mode — list every stub remaining across B1–B5
  2. Agent mode — replace each with real import from sideA.js
  3. Fresh Cursor chat — run full flow: sign-in → scrape → Telegram confirm → apply → SUBMITTED
- **Checkpoint:** Given real Handshake account, full flow completes. Intervention popup fires in monitoring UI and resolves correctly. SUBMITTED written only after DOM verification.
- **Git:** `integration/v1-full-flow` — both sides review together before merge

## Hardening (after integration pass)
For each failure class, ensure:
- safeExit is always reached
- `markJobStatus(FAILED, reason)` is called with a useful reason string
- No browser session is left open on any unhandled exception
- Specifically test: selector not found, job listing gone, Quick Apply disappeared, already applied, rate limit hit
