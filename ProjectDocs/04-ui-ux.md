# UI/UX — Handshake Auto-Apply Bot (MVP)

## Screens/pages list
1. Onboarding Form
2. Job Link Submission
3. Bot Status
4. Live Handoff View
5. Telegram Prompt (deep-link/notice only, actual exchange happens in Telegram)
6. Run Summary

## Per screen

### 1. Onboarding Form
- **Purpose:** collect the fixed field set into Supabase before any bot activity.
- **Key elements:** name (first/last), email, phone, school, major, degree pursuing, grad month/year, school-specific info (text), resume upload, job types (multi-select: Full-time/Part-time/Internship/Not sure yet), locations open to, job interests, profile visibility (default Community, with the standard explanatory copy), job alerts toggle, "Link Telegram" button (deep link, unconditional), existing-Handshake-account Yes/No, conditional "Connect Gmail (readonly)" OAuth button — rendered only when Yes is selected, with a short explainer that this is read-only and used only to read the Handshake OTP.
- **States:** empty (defaults blank), validating (email format, resume size/type), telegram-pending/linked, gmail-pending/connected (conditional), error (inline per field), submitted (locked, read-only recap).

### 2. Job Link Submission
- **Purpose:** capture the single Handshake job link that triggers the bot.
- **Key elements:** URL input, submit button, short explainer copy ("this starts the bot").
- **States:** empty, invalid URL, submitting, submitted (redirects to Bot Status).

### 3. Bot Status
- **Purpose:** show current workflow step in plain language (Signing in… / Applying… / Needs you / Done).
- **Key elements:** step label, progress indicator, conditional CTA ("Open live view" / "Check Telegram").
- **States:** loading, running, paused-needs-live-handoff, paused-needs-telegram, success, failed (with reason).

### 4. Live Handoff View
- **Purpose:** let the user complete a step the bot can't (email verification, unexpected field) inside the same session.
- **Key elements:** embedded live browser view, "I'm done" button to signal resume, exit-to-main-app option.
- **States:** connecting, live/user-active (bot paused), resuming, error (session lost).

### 5. Telegram Prompt
- **Purpose:** tell the user a document or answer is needed and where to provide it.
- **Key elements:** short notice + deep link to the bot's Telegram chat.
- **States:** waiting-for-reply, received (auto-dismisses on resume).

### 6. Run Summary
- **Purpose:** confirm outcome of the apply run.
- **Key elements:** success/failure banner, job title/link, timestamp; on failure, plain-language reason.
- **States:** success, failed.

## Navigation map
Onboarding Form → Job Link Submission → Bot Status ⇄ (Live Handoff View | Telegram Prompt) → Run Summary → (back to Job Link Submission for next test run)

## Design notes
- No dedicated design system this phase — use RN default components + a single accent color; revisit once the full app is scoped.
- Bot Status must poll or subscribe to workflow state (Supabase realtime or polling) rather than assume a fixed duration — pauses can last indefinitely.
