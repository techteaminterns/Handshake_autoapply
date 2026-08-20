# Workflow — Side B (Browser automation / bot only)

**Owns:** all Playwright code, all Handshake page interaction — signup, login, apply.
**Does not own:** Supabase schema, the app, Telegram/Gmail infra, the workflow skeleton, live-handoff app-side, reporting. Side A owns all of that — you call into their functions, you don't build them.

---

## Interface Contract (shared with Side A — do not change without telling them)

Functions **Side A implements, you call:**
| Function | Purpose |
|---|---|
| `getProfileForHandshake(profileId)` | Onboarding answers formatted for filling Handshake's forms |
| `getResumeUrl(profileId)` | Supabase Storage URL for the current resume |
| `getReusableAnswer(profileId, questionText)` | Returns a stored answer or `null` |
| `pauseAndRequestAnswer(profileId, questionText)` | Pauses the workflow, sends a Telegram prompt, resumes with the reply |
| `pauseForLiveHandoff(runId, contextLabel)` | Pauses the workflow until the user signals "done" |
| `readOtpFromGmail(profileId)` | Reads the Handshake OTP via Gmail API |
| `checkAndIncrementActionCount(runId)` | Returns `false` if the 300/day cap is hit |
| `markRunStatus(runId, status, failureReason?)` | Updates `bot_runs.status` |

Functions **you implement, Side A's workflow skeleton calls:**
| Function | Purpose |
|---|---|
| `runCreateAccount(profile, runId)` | Full Handshake signup flow |
| `runOtpLogin(profile, runId)` | Full Handshake login flow |
| `runApplyToJob(jobLink, profileId, runId)` | Full apply flow |
| `safeExit(browserSession)` | Closes the browser session cleanly |

Until Side A's real function exists, build against a stub returning fixture data matching `05-backend-schema.md` shapes — don't wait on them.

## Sync Points (coordinate with Side A at these moments)
- **B1 (createAccount) real integration** needs Side A's `getProfileForHandshake` and `pauseForLiveHandoff` — build B1 against stubs first, integrate once Side A flags those merged.
- **B2 (otpLogin) real integration** needs Side A's `readOtpFromGmail` — same pattern.
- **B3 (applyToJob) real integration** needs Side A's `getResumeUrl`, `getReusableAnswer`, `pauseAndRequestAnswer`, `checkAndIncrementActionCount`.
- **Major sync — B4 "integration pass":** sit together, swap every stub for the real function, run one full end-to-end flow live.

## Branching & PR conventions
- Branch naming: `side-b/phaseN-<short-name>`, e.g. `side-b/phase1-create-account`.
- Commit at every checkpoint pass — one commit per checkpoint, not one giant commit per phase.
- Open a PR into `main` as soon as a phase's checkpoint passes. PR description: paste the checkpoint's Given/When/Then and confirm it passes, and note which stubs are still in place vs. wired to real functions.
- Request review from Side A before merging.
- Squash-merge, delete the branch after merge.
- Never merge a phase whose checkpoint hasn't been self-tested against a real Handshake page (fixture data is fine for inputs, but the page interaction itself must be tested live, not mocked).

---

## Phase B0 — Environment setup
- **Goal:** a minimal standalone script can launch headless Chromium and load a Handshake page — nothing else yet.
- **Files/modules:** `bot/` scaffold, `playwright-core` + `@sparticuz/chromium` install, a throwaway script to open Handshake's signup page and confirm rendering.
- **Cursor prompt order:** (1) Plan mode — `@bot-playwright.mdc Set up playwright-core with @sparticuz/chromium for a Vercel-compatible bundle.` (2) Agent mode — install, write the throwaway script.
- **Checkpoint:** Given the script runs, when executed, then a screenshot of Handshake's signup page is produced and the bundle stays under 250MB.
- **Docs automation:** confirm AGENTS.md end-of-slice rule fired.
- **Git/PR:** branch `side-b/phase0-setup`, commit + PR at checkpoint pass.

## Phase B1 — `runCreateAccount`
- **Goal:** full signup flow, ending in a live-handoff pause at email verification.
- **Files/modules:** `runCreateAccount(profile, runId)`, using a fixture `profile` object shaped like `getProfileForHandshake`'s return value until Side A's real function lands.
- **Cursor prompt order:** (1) Plan mode — `@03-workflow.md Outline the createAccount branch step by step, including the "Maybe later" network prompt and the live-handoff pause point.` (2) Agent mode — build the fill-and-click sequence through to the network prompt, always selecting "Maybe later." (3) Agent mode — build the pause call (stubbed `pauseForLiveHandoff` for now) and the remaining Handshake onboarding screens that run after resume. (4) Agent mode — wrap the whole function so every exit path (success, error) calls `safeExit`.
- **Checkpoint:** Given a fixture profile, when the script runs, then it fills every field correctly, selects "Maybe later," and pauses cleanly at email verification with the browser session still valid for resume.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-b/phase1-create-account`, commit + PR at checkpoint pass (note: stubbed pause, integrate after Side A's A6 merges).

## Phase B2 — `runOtpLogin`
- **Goal:** full login flow using an OTP read via Side A's function.
- **Files/modules:** `runOtpLogin(profile, runId)`.
- **Cursor prompt order:** (1) Plan mode — outline the login → OTP-field-wait → submit sequence from `03-workflow.md`. (2) Agent mode — build the flow, calling a stubbed `readOtpFromGmail` until Side A's A4 merges. (3) Agent mode — wrap with `safeExit` on every exit path.
- **Checkpoint:** Given a fixture OTP code returned by the stub, when the script runs, then it logs in successfully.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-b/phase2-otp-login`, commit + PR at checkpoint pass (note: stubbed OTP read, integrate after Side A's A4 merges).

## Phase B3 — `runApplyToJob`
- **Goal:** full apply flow, Quick Apply preferred, resume via "Upload new," missing answers routed to the fallback.
- **Files/modules:** `runApplyToJob(jobLink, profileId, runId)`.
- **Cursor prompt order:** (1) Plan mode — `@03-workflow.md @bot-playwright.mdc Outline the apply flow: Quick Apply/Apply detection, document upload, per-question answer lookup.` (2) Agent mode — build Quick Apply/Apply detection (Quick Apply always wins when both present). (3) Agent mode — build document upload, always "Upload new," using a stubbed `getResumeUrl`. (4) Agent mode — build the per-question loop calling stubbed `getReusableAnswer` then stubbed `pauseAndRequestAnswer` if not found, and a stubbed `checkAndIncrementActionCount` check before each Handshake action. (5) Agent mode — wrap with `safeExit` on every exit path, submit at the end.
- **Checkpoint:** Given a job link with both Quick Apply and Apply available, when the script runs, then Quick Apply is used, the resume attaches via "Upload new," and an unanswered question correctly falls through to the (stubbed) fallback call.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-b/phase3-apply`, commit + PR at checkpoint pass (note: all four stubs still in place).

## Phase B4 — Integration pass
- **Goal:** every stub replaced with Side A's real function; one full end-to-end run works live.
- **Files/modules:** all three run functions, now wired to real Side A exports.
- **Cursor prompt order:** (1) Plan mode — list every remaining stub across B1–B3 and confirm Side A's matching PRs are merged. (2) Agent mode — replace each stub import with the real one. (3) Fresh Cursor chat — run one full flow live: onboarding → job link submit → auth → apply → safe exit.
- **Checkpoint:** Given a real test profile and a real job link, when the full flow runs unattended except for the deliberate live-handoff pause, then it completes with `bot_runs.status = succeeded`.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-b/phase4-integration`, commit + PR at checkpoint pass. **This is the milestone PR — both of you review it together.**

## Phase B5 — Hardening
- **Goal:** every failure path still reaches `safeExit` and reports an accurate status.
- **Files/modules:** error handling across all three run functions.
- **Cursor prompt order:** (1) Plan mode — enumerate every likely failure (selector not found, job listing gone, rate-limit hit, browser crash). (2) Agent mode — wrap each in try/catch routing to `safeExit` + `markRunStatus(runId, 'failed', reason)`.
- **Checkpoint:** Given a deliberately broken selector, when the run fails, then no browser session is left open and `bot_runs.failure_reason` is populated with something useful.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-b/phase5-hardening`, commit + PR at checkpoint pass.
