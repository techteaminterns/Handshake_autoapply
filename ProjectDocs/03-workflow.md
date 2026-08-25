# Workflow — Handshake Auto-Apply Bot (MVP)

## App Flow (high-level)
1. User opens app → minimal onboarding form (single scroll or short multi-step).
2. User answers all fixed fields, uploads resume, answers "existing Handshake account?".
3. User submits Handshake job link → **bot trigger fires**.
4. App shows bot status (running / needs you / done).
5. If live handoff needed → app shows embedded live browser view → user acts → bot resumes.
6. If Telegram needed → app shows "check Telegram" prompt → user replies there → bot resumes.
7. Bot completes apply → app shows success/failure summary.
8. (Separately, daily) → user receives report email.

## User flow per core feature

**Onboarding submission**
1. Fill fixed fields (name, email, phone, school, major, degree, grad month/year, school-specific info, job-type/location/interest prefs, visibility, alerts).
2. Upload resume (PDF <1MB).
3. Link Telegram — tap deep link → starts chat with the app's single bot → webhook captures `chat_id` → stored on profile.
4. Answer existing-Handshake-account Yes/No.
5. Connect Gmail (readonly OAuth) — required for all users, regardless of the existing-account answer. Used for automated OTP read on the login branch (Yes); collected upfront on the signup branch (No) too, so it's already on file if a later run needs it.
6. Submit → all fields written to Supabase.

**Job link submission → bot trigger**
1. User pastes Handshake job link.
2. Submit → `handshakeBotWorkflow` starts with the stored onboarding profile + job link.

**Authenticate step**
- If **No** (no existing account): bot opens Handshake signup, fills fields from stored profile in order, reaches network-connections prompt → selects **"Maybe later"**, continues to email verification → **pauses, live handoff** → user logs in / verifies in the embedded view → bot detects completion → resumes → finishes remaining onboarding screens in Handshake using stored answers → **safely exits** the signup portion.
- If **Yes** (existing account): bot triggers Handshake login → Handshake sends OTP to student email → bot reads OTP via readonly Gmail API automation → completes login → no live handoff needed for this branch.

**Apply step**
1. Bot opens the submitted job link.
2. Detect Quick Apply / Apply availability → if both present, **always choose Quick Apply**.
3. Reach document selection → **always choose "Upload new"** → attach resume from Supabase.
4. For each application question:
   - Check Supabase reusable-answers store first.
   - If found → auto-fill.
   - If not found → pause, send Telegram request to user → on reply, store answer in Supabase, fill, continue.
5. Same pattern for any additional requested document (<1MB) not already in Supabase.
6. Submit application.
7. **Safely exit** the browser session.

**Daily report**
1. Cron fires once daily.
2. Query Supabase for the day's applications + any status changes on prior ones.
3. Send summary email via Resend.

## Mock Handshake test site
- **Purpose:** exercise the bot's signup/login/apply flows without needing a real Handshake account or a real student email inbox.
- **Hosted at:** `/mock-handshake` routes on the same Vercel deployment as the app/API.
- **Signup flow pages:** email entry → school dropdown → SSO/set password (this is the page where **live handoff** triggers, mirroring the real Handshake email-verification pause point) → onboarding questions → done.
- **Apply flow:** a mock job page with Quick Apply/Apply buttons, document upload, and screening questions.
- **OTP testing:** OTP emails for the login branch are sent from `portgasdiscordace@gmail.com`, so `readOtpFromGmail` can be tested end-to-end against a real inbox without touching real Handshake.
- **DOM parity requirement:** selectors on every mock page must mirror real Handshake's DOM exactly, so Side B's bot code runs unmodified against both the mock site and real Handshake.

## System/data flow
- Onboarding submit → Supabase write (profile, resume URL) → no bot trigger yet.
- Job link submit → Vercel API → starts `handshakeBotWorkflow` (Vercel Workflow) → Playwright step runs in a Vercel Function → workflow persists state between steps → resumes on hook (live-handoff signal, Telegram reply, or OTP-read completion) → final step writes application record to Supabase → app polls/subscribes to status.

## Edge cases & error states
- Resume missing or >1MB at onboarding → block submission, inline error.
- Job link malformed/not a Handshake URL → block trigger, inline error.
- Live handoff timeout (user never returns) → workflow stays paused (no cost while paused); surface "waiting on you" state indefinitely, no auto-cancel this phase.
- Telegram reply timeout → same: workflow stays paused, no auto-cancel this phase.
- OTP not received/expired → pause, fall back to live handoff for manual login.
- Neither Quick Apply nor Apply available (e.g. external application) → mark run failed, notify user, safely exit — no automation for external ATS this phase.
- Handshake selector/DOM mismatch mid-run → fail the run, log the step, safely exit — no retry-with-different-selector logic this phase.
- Daily action count hits 300 → halt further bot actions until next day, log the halt reason.
