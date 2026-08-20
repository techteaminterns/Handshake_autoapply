# Workflow — Side A (Everything except browser automation)

**Owns:** Supabase schema/RLS, RN app, onboarding, Telegram infra, Gmail OAuth, Vercel Workflow orchestration skeleton, live handoff app-side, Bot Status, daily report.
**Does not own:** any Playwright code, any Handshake page interaction. Side B owns that entirely — Side A only calls into it and receives status back.

---

## Interface Contract (shared with Side B — do not change without telling them)

Functions **Side A implements, Side B calls:**
| Function | Purpose |
|---|---|
| `getProfileForHandshake(profileId)` | Returns onboarding answers formatted for filling Handshake's forms |
| `getResumeUrl(profileId)` | Supabase Storage URL for the current resume |
| `getReusableAnswer(profileId, questionText)` | Returns a stored answer or `null` |
| `pauseAndRequestAnswer(profileId, questionText)` | Pauses the workflow, sends a Telegram prompt, resumes with the reply, persists it to `reusable_answers` |
| `pauseForLiveHandoff(runId, contextLabel)` | Pauses the workflow until the user signals "done" in the live-view screen |
| `readOtpFromGmail(profileId)` | Reads the Handshake OTP via Gmail API (not Playwright) |
| `checkAndIncrementActionCount(runId)` | Returns `false` if the 300/day cap is hit |
| `markRunStatus(runId, status, failureReason?)` | Updates `bot_runs.status` |

Functions **Side B implements, Side A's workflow skeleton calls:**
| Function | Purpose |
|---|---|
| `runCreateAccount(profile, runId)` | Full Handshake signup flow |
| `runOtpLogin(profile, runId)` | Full Handshake login flow |
| `runApplyToJob(jobLink, profileId, runId)` | Full apply flow |
| `safeExit(browserSession)` | Closes the browser session cleanly |

Until the real function exists on either side, the other side builds against a stub returning fixture data — don't block on the other person.

## Sync Points (coordinate with Side B at these moments)
- **Before B1 integrates:** `getProfileForHandshake` (A6) and `getResumeUrl` (A2) must be real.
- **Before B2 integrates:** `readOtpFromGmail` (A4) must be real.
- **Before B3 integrates:** `pauseAndRequestAnswer`, `getReusableAnswer`, `checkAndIncrementActionCount` (A7) must be real.
- **Major sync — B4 "integration pass":** sit together, swap every stub for the real function, run one full end-to-end flow live.

## Branching & PR conventions
- Branch naming: `side-a/phaseN-<short-name>`, e.g. `side-a/phase2-onboarding`.
- Commit at every checkpoint pass — one commit per checkpoint, not one giant commit per phase.
- Open a PR into `main` as soon as a phase's checkpoint passes. PR description: paste the checkpoint's Given/When/Then and confirm it passes.
- Request review from Side B before merging — even a fast pass, since your code exposes the functions their bot depends on.
- Squash-merge, delete the branch after merge.
- Never merge a phase whose checkpoint hasn't been self-tested.

---

## Phase A0 — One-time manual setup
- **Goal:** Telegram bot and Google OAuth client exist before any code needs them.
- **Not Cursor:** message @BotFather → `/newbot` → token to Vercel env as `TELEGRAM_BOT_TOKEN`. Google Cloud Console → new project → OAuth consent screen → Testing status → allowlist your test account(s) → OAuth Client ID/secret to Vercel env.
- **Checkpoint:** both env vars are set in Vercel; a test message can be sent through the bot token manually (e.g. via curl).
- **Git:** commit env var documentation (not the secrets themselves) to `side-a/phase0-setup`. No PR needed — this is config, note it in the phase-A1 PR instead.

## Phase A1 — Supabase schema + RLS
- **Files/modules:** migrations for every table in `05-backend-schema.md`, RLS policies.
- **Cursor prompt order:** (1) Plan mode — `@05-backend-schema.md Draft the Supabase migration SQL for every table and RLS policy in this doc, verbatim.` (2) Agent mode — apply, generate policies. (3) Plan mode — `@AGENTS.md @supabase.mdc Confirm gmail_oauth_tokens blocks client-role reads.` (4) Agent mode — fix if not.
- **Checkpoint:** Given any table with personal data, when queried as a different user's session, then RLS blocks the read.
- **Docs automation:** confirm AGENTS.md end-of-slice rule fired.
- **Git/PR:** branch `side-a/phase1-schema`, commit + PR at checkpoint pass.

## Phase A2 — Onboarding screen + resume upload
- **Files/modules:** RN onboarding screen (all fields per `04-ui-ux.md`), `/api/onboarding`, resume upload to Storage, `getResumeUrl(profileId)`.
- **Cursor prompt order:** (1) Plan mode — `@04-ui-ux.md @01-prd.md Draft the onboarding screen field list and states.` (2) Agent mode — build screen. (3) Agent mode — build `/api/onboarding` + Storage upload + `getResumeUrl`.
- **Checkpoint:** Given a filled form with a <1MB PDF resume, when submitted, then `profiles` + `resumes` rows exist and `getResumeUrl` returns a working URL.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase2-onboarding`, commit + PR at checkpoint pass.

## Phase A3 — Telegram linking infra
- **Files/modules:** `/api/telegram/webhook` (link-capture + a reusable send/receive utility for later reuse in A7), "Link Telegram" button + deep link.
- **Cursor prompt order:** (1) Plan mode — outline the deep-link "start" capture sequence. (2) Agent mode — build webhook capturing `chat_id` into `profiles`. (3) Agent mode — build a reusable `sendTelegramMessage(chatId, text)` / `onTelegramReply(...)` utility, kept generic — Phase A7 will call it, don't hardcode the fallback use case into it here.
- **Checkpoint:** Given a user taps the deep link, when they start the chat, then `profiles.telegram_chat_id` is populated.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase3-telegram-infra`, commit + PR at checkpoint pass.

## Phase A4 — Gmail OAuth + OTP read
- **Files/modules:** `/api/oauth/gmail/start`, `/api/oauth/gmail/callback`, `gmail_oauth_tokens` writes, `readOtpFromGmail(profileId)`.
- **Cursor prompt order:** (1) Plan mode — outline OAuth redirect flow against `02-trd.md`'s restricted-scope notes. (2) Agent mode — build start/callback, encrypted token storage. (3) Agent mode — build `readOtpFromGmail` (Gmail API `messages.list`/`get`, filtered to recent Handshake senders, parse the OTP).
- **Checkpoint:** Given a connected Gmail account and a real Handshake OTP email, when `readOtpFromGmail` is called, then it returns the correct code within a few seconds.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase4-gmail-otp`, commit + PR at checkpoint pass. **Tell Side B this PR merged — unblocks their B2 integration.**

## Phase A5 — Workflow skeleton + bot trigger
- **Files/modules:** `handshakeBotWorkflow` (`'use workflow'`), branch logic on `has_existing_handshake_account`, calls to Side B's `runCreateAccount`/`runOtpLogin`/`runApplyToJob` (stubbed until Side B's phases land), `/api/bot/trigger`, `markRunStatus`.
- **Cursor prompt order:** (1) Plan mode — `@03-workflow.md @workflows.mdc Draft the workflow skeleton and branch logic.` (2) Agent mode — build skeleton with stub calls to Side B's four functions returning fixture success. (3) Agent mode — build `/api/bot/trigger` creating a `bot_runs` row and starting the workflow.
- **Checkpoint:** Given a job-link submission, when the trigger fires, then a `bot_runs` row is created, the workflow starts, and the correct branch (create vs login) is selected based on the stored profile.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase5-workflow-skeleton`, commit + PR at checkpoint pass. **Tell Side B this PR merged — they can now wire real calls into the skeleton.**

## Phase A6 — Live handoff (app-side)
- **Files/modules:** RN live-view screen, `/api/bot/live-handoff/resume`, `pauseForLiveHandoff(runId, contextLabel)`, `getProfileForHandshake(profileId)`.
- **Cursor prompt order:** (1) Plan mode — `@04-ui-ux.md Draft the live-handoff screen states.` (2) Agent mode — build screen + resume endpoint. (3) Agent mode — build `pauseForLiveHandoff` as a workflow hook, and `getProfileForHandshake` formatting `profiles` fields for Handshake's forms.
- **Checkpoint:** Given a paused run at live handoff, when the user taps "I'm done," then the workflow resumes from the correct point.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase6-live-handoff`, commit + PR at checkpoint pass. **Tell Side B — unblocks real B1 integration.**

## Phase A7 — Telegram fallback + rate limit
- **Files/modules:** `pauseAndRequestAnswer(profileId, questionText)` (built on A3's send/receive utility), `getReusableAnswer`, `checkAndIncrementActionCount`.
- **Cursor prompt order:** (1) Plan mode — outline the pause/notify/resume/persist sequence. (2) Agent mode — build `pauseAndRequestAnswer` + write-through to `reusable_answers`. (3) Agent mode — build `getReusableAnswer` (checked first) and `checkAndIncrementActionCount` against `bot_runs.actions_count`.
- **Checkpoint:** Given an unanswered question, when the fallback fires and the user replies, then the run resumes, the answer is stored, and a repeat question skips the fallback entirely.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase7-telegram-fallback`, commit + PR at checkpoint pass. **Tell Side B — unblocks real B3 integration.**

## Phase A8 — Bot Status screen
- **Files/modules:** RN Bot Status screen, subscription/poll on `bot_runs.status`.
- **Cursor prompt order:** (1) Plan mode — `@04-ui-ux.md Draft the Bot Status screen states.` (2) Agent mode — build with realtime subscription, no fixed-duration assumptions.
- **Checkpoint:** Given a run transitions through states, when viewed live, then the screen reflects each state without a page refresh.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase8-bot-status`, commit + PR at checkpoint pass.

## Phase A9 — Daily report
- **Files/modules:** `/api/reports/daily`, Vercel Cron config, Resend integration.
- **Cursor prompt order:** (1) Plan mode — outline report content from `01-prd.md` success metrics. (2) Agent mode — build query + send + cron config.
- **Checkpoint:** Given at least one `bot_runs` row from today, when cron fires, then an accurate summary email arrives.
- **Docs automation:** confirm.
- **Git/PR:** branch `side-a/phase9-daily-report`, commit + PR at checkpoint pass.
