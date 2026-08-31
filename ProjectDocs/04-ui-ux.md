# UI/UX — OneClickHandshake V1

## Screens/Pages List
1. Auth Screen (existing)
2. Onboarding Screen (extend existing)
3. Monitoring UI Screen (new)
4. OTP / Intervention Popup (overlay on Monitoring UI)

## Per Screen

### 1. Auth Screen
- **Purpose:** sign up / sign in to our platform via Supabase Auth
- **Key elements:** email + password, sign up / sign in toggle
- **States:** empty, submitting, error (inline), success (navigates to Onboarding if no profile, else Monitoring UI)
- **Status:** existing, no changes needed

### 2. Onboarding Screen (extend existing)
- **Purpose:** collect all user info + preferences; store to DB; link Telegram
- **Key elements (existing):** name, email, phone, school, major, degree, grad month/year, school info, resume upload, job types (multi-select), locations, job interests, profile visibility, job alerts toggle, Telegram deep-link button
- **New elements to add:**
  - "Do you have a Handshake account?" Yes/No toggle
  - If Yes: text field for Handshake email (pre-filled with student email if available)
- **States:** empty (defaults), validating (email format, resume size/type), telegram-pending/linked, error (inline per field), submitted (navigates to Monitoring UI)

### 3. Monitoring UI Screen (new)
- **Purpose:** single screen showing everything about the bot — status, jobs, interventions
- **Key elements:**
  - **Header strip:** bot status badge (Idle / Running / Needs Input / Error), last session health check time
  - **Stats row:** Queued · Approved · Applied · Failed · Rejected
  - **Current job card:** job title, company, URL, current step, elapsed time (shown only when bot is actively applying)
  - **Step progress:** Open → Login Check → Quick Apply → Resume → Questions → Submit → Verify (checkmarks for done, spinner for current, gray for pending)
  - **Job queue table:** columns — #, Title, Company, Status badge, Action (view job link)
  - **Telegram status line:** "Waiting for your reply on [job title]" when a yes/no is pending
- **States:**
  - `idle` — no active run, queue empty or all terminal
  - `running` — current job card visible, step progress active
  - `needs_input` — intervention popup overlays screen
  - `waiting_telegram` — Telegram status line visible
  - `error` — bot status badge red, last error reason shown

### 4. OTP / Intervention Popup (overlay)
- **Purpose:** surface bot-blocking intervention to user; collect answer; resume bot
- **Triggered by:** Supabase Realtime on new OPEN intervention row
- **Types and display:**

| Type | Popup content |
|---|---|
| `OTP` | "Handshake sent a code to [email/phone]. Enter it here." + 6-digit input + Submit |
| `EMAIL_CONFIRM` | "Please confirm your Handshake email, then tap Done." + Done button |
| `UNKNOWN_QUESTION` | Question text + options (if multiple choice) or free text input + Submit |
| `AUTH` | "Bot needs to sign in again. Tap Ready after you see the login screen." + Ready button |

- **States:** open (waiting for user input), submitting (answer being written to DB), resolved (auto-dismisses, bot resumes)
- **Rules:** non-dismissable until resolved; only one popup at a time; answer persisted to interventions table

## Navigation Map
Auth → (if no profile) Onboarding → Monitoring UI
Auth → (if profile exists) Monitoring UI
Monitoring UI ← Intervention Popup (overlay, not a separate screen)

## Design Notes
- Use existing RN default components; no new UI library
- Single accent color (existing app accent)
- Status badges: gray (Queued/Idle), blue (Running/Processing), amber (Needs Input), green (Applied/Submitted), red (Failed), dark gray (Rejected)
- Status must never rely on color alone — always show text label
- Monitoring UI job queue: poll or Supabase Realtime subscription — no page refresh
- Intervention popup: non-dismissable, keyboard-aware (input scrolls above keyboard on mobile)
- Bot step progress: only visible when status = running; hidden when idle
