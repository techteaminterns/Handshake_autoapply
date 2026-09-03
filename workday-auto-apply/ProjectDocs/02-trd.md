# TRD — Technical Requirements Document

## System Overview

The automation bot is a Node.js application that uses Playwright to drive a Chromium browser, filling job application forms autonomously. The system progressively evolves from a single-user CLI tool to a multi-user, cloud-deployed product with a Supabase backend, Telegram integration, and a React-based monitoring dashboard.

---

## Technology Stack

### Core Runtime

| Component | Technology | Rationale |
|---|---|---|
| Bot engine | Node.js ≥18 (ESM modules) | Existing codebase; async/await; native IMAP support |
| Browser automation | Playwright (Chromium) | Existing; handles complex SPAs, Workday wizard, file upload |
| Language | JavaScript / TypeScript | Existing is JS; TypeScript added progressively for dashboard/API |
| Package format | ESM (`.mjs`) | Existing convention; top-level await support |

### Backend / Database

| Component | Technology | Rationale |
|---|---|---|
| Database | Supabase (PostgreSQL) | Managed Postgres; realtime subscriptions; Row Level Security |
| Auth | Supabase Auth | User session management for dashboard |
| Storage | Supabase Storage | Resume PDF files per user |
| API | Supabase Edge Functions or Node.js API routes | Bot-to-database writes; dashboard data fetch |

### Messaging

| Component | Technology | Rationale |
|---|---|---|
| Confirmation & Fallback | Telegram Bot API | User-facing confirmation; inline Yes/No buttons; Q&A fallback for unmapped questions |
| OTP handling (pre-dashboard) | Terminal Prompt (`readline`) | In V0/V1, bot prompts user in terminal for OTP, reads input, and auto-fills field |
| OTP handling (post-dashboard)| Monitoring UI / Telegram | User submits OTP via dashboard popup or Telegram when bot detects prompt (V2+) |

### Dashboard / Frontend

| Component | Technology | Rationale |
|---|---|---|
| Framework | React (or React Native Web) | Monitoring dashboard; consistent with existing RN patterns in workspace |
| Styling | Tailwind CSS or plain CSS | Practical for internal dashboard |
| Real-time updates | Supabase Realtime | Live bot status without polling |

### Infrastructure

| Component | Technology | Rationale |
|---|---|---|
| Bot deployment | Railway | Simple Node.js worker deployment; persistent processes |
| Containerization | Docker | Reliable Chromium environment; dependency isolation |
| Secrets management | Railway environment variables | Secure credential storage |
| Local development | Node.js + `.env` | Existing workflow retained for development |

---

## Architecture by Version

### V0 — CLI (Existing)

```
Terminal
  │
  ▼
cli.mjs (Node.js)
  │
  ├── scanner.mjs      → Playwright → Job URL DOM
  ├── planner.mjs      → profile.yml → Plan JSON
  ├── engine.mjs       → Playwright → Form fill + Submit
  ├── workday.mjs      → Playwright → Workday auth
  ├── otp.mjs          → Terminal prompt (readline) → OTP code
  └── learner.mjs      → data/learnings.json
```

**State:** Local flat files (YAML, JSON, CSV).

---

### V1 — Telegram Added

```
Terminal / Script
  │
  ▼
Bot Process (Node.js)
  │
  ├── [Existing automation pipeline]
  │
  ├── Telegram Bot API
  │     ├── Send: Job info + Yes/No buttons
  │     ├── Receive: Webhook/polling callback → proceed or skip
  │     └── Q&A Fallback: Bot asks unmapped question → receives answer → stores to profile.yml
  │
  └── Resume Parser
        └── Extracts text & answers → persists to profile.yml for reuse
```

**State:** Local flat files (profile.yml acts as DB for newly saved answers).

---

### V2 — Supabase + Dashboard + Parallel Multi-User Workers

```
Dashboard (React)
  │  ▲ Realtime subscriptions
  │  │
  ▼  │
Supabase (Postgres + Auth + Storage + Realtime)
  │  ▲
  │  │ reads/writes
  ▼  │
Worker Pool (Node.js on Railway)
  │
  ├── Worker 1 (User A) ──► Isolated Browser ──► Sequential Queue (Job A1 → A2 → ...)
  ├── Worker 2 (User B) ──► Isolated Browser ──► Sequential Queue (Job B1 → B2 → ...)
  └── Worker N (User N) ──► Isolated Browser ──► Sequential Queue (Job N1 → N2 → ...)
        │
        └── Telegram Bot API (Confirmation & Q&A Fallback per user)
```

**Execution Model:**
- **Parallel across users:** N workers execute in parallel for N users (e.g., 3 users = 3 concurrent workers).
- **Sequential per user:** Each worker processes its assigned user's job queue sequentially, opening an isolated browser for a job link, applying, and repeating until all jobs in that user's queue are exhausted.
- **State:** All persistent state in Supabase. Dashboard reads Supabase directly via Realtime + REST.

---

### V3 — Docker + Railway

```
Railway
  └── Docker Container
        ├── Worker Manager & Parallel Worker Pool
        │     ├── Worker 1 (User 1): Playwright Headless (Isolated Context)
        │     ├── Worker 2 (User 2): Playwright Headless (Isolated Context)
        │     └── Worker N (User N): Playwright Headless (Isolated Context)
        └── Environment Variables (secrets)

Dashboard → Supabase → Worker Manager / Worker Pool
```

---

## Module Architecture (Bot Engine)

```
bot/
├── index.mjs               — Worker entry point & parallel worker manager
├── lib/
│   ├── scanner.mjs         — Form field scanner [EXISTING]
│   ├── planner.mjs         — Answer planner + FIELD_MAP [EXISTING]
│   ├── engine.mjs          — Fill engine + Workday wizard [EXISTING]
│   ├── workday.mjs         — Workday auth [EXISTING]
│   ├── discovery.mjs       — ATS detection + navigation [EXISTING]
│   ├── fields.mjs          — Field finder + dropdown handler [EXISTING]
│   ├── otp.mjs             — OTP detection & terminal/UI prompt [UPDATED]
│   ├── resumeParser.mjs    — Resume text extraction & answer persister [NEW]
│   ├── learner.mjs         — Self-learning store [EXISTING → Supabase in V2]
│   └── reporter.mjs        — Logging + screenshots [EXISTING → Supabase in V2]
├── telegram/
│   ├── bot.mjs             — Telegram bot instance
│   ├── confirmJob.mjs      — Send job confirmation message with buttons
│   ├── fallbackQA.mjs      — Prompt user for unknown fields & store response [NEW]
│   └── webhook.mjs         — Handle Yes/No callback & answer replies
└── queue/
    ├── workerPool.mjs      — Multi-user parallel worker dispatcher [NEW]
    ├── processQueue.mjs    — Per-user sequential job processor [UPDATED]
    └── claimJob.mjs        — Atomic job claim from Supabase queue
```

---

## Technical Requirements by Area

### Browser Automation

- Must support Chromium via Playwright
- Must support `headless: false` for local development, `headless: true` for server deployment
- Viewport: 1280×900 minimum
- User agent: realistic desktop browser string (not default Playwright UA)
- Must handle SPA navigation (waitForLoadState, networkidle, explicit timeouts)
- Must handle Workday's 5-step wizard pattern reliably
- Must handle resume PDF upload with async verification
- Must handle post-submit OTP detection and entry

### ATS Support (Existing)

- Greenhouse, Lever, Ashby, Workday, Gem, iCIMS, SmartRecruiters, Generic
- Workday requires account creation or sign-in before form access
- Other ATS platforms generally do not require prior authentication

### Field Handling

- All standard HTML input types: text, email, tel, file, checkbox, radio, select
- Custom patterns: yes-no-button (Ashby), typeahead, multi-select, React Select, ARIA dropdowns
- Field resolution: 6-strategy fallback chain (selector, automation-id, id, name, getByLabel, proximity)
- Name aliases: First name also satisfies "given name"; last name also satisfies "family name" and "surname"
- Dropdown resolution: 4-strategy fallback (native select, type+enter, click-scan, keyboard nav)
- Fuzzy matching: word overlap scoring (0–1) for option text mismatch
- Multi-tier Answer Resolution Cascade:
  1. Profile data (`profile.yml` / Supabase)
  2. Parsed resume answers: extracted and stored to DB/profile for all future runs
  3. Telegram Q&A Fallback: if answer is missing from both profile and resume, bot messages user on Telegram, receives answer, fills field, and persists answer to DB/profile
  4. Skip / unmapped (if user does not respond within timeout)

### Telegram Integration

- Bot created via BotFather; token stored in environment variable
- Job confirmation message must include: job title, company, URL (truncated if long)
- Must use inline keyboard with Yes/No buttons
- Callback query handled via webhook/polling
- Yes response → mark job as `confirmed`, proceed with application
- No response → mark job as `skipped`, move to next job
- Timeout (no response within configurable window) → mark as `pending`, do not apply
- Interactive Q&A Fallback: sends unanswerable questions to user, listens for response, and feeds answer back into the engine while saving it to storage

### OTP Handling

- Pre-Dashboard (V0/V1): Terminal prompt via stdin/readline
  - Page detects verification/OTP prompt
  - Terminal prompts user: `Enter OTP code:`
  - User enters code directly into terminal
  - Bot enters code character by character (`.type()` with delay, not `.fill()`) for reliability
  - No Google/Gmail IMAP retrieval needed
- Post-Dashboard (V2+): UI popup in monitoring dashboard or Telegram intervention prompt passes OTP to the worker
- Handles both account creation verification and post-submit OTP

### Database (Supabase — V2+)

- All user profile data stored in Supabase `users` and `user_profiles` tables
- Newly discovered answers (from resume parsing or Telegram fallback) persisted to `user_profiles` or dedicated answers table
- Jobs stored in `jobs` table with per-user queue entries in `job_queue` table
- Application status tracked in `applications` table
- Bot status and events in `bot_runs` and `bot_events` tables
- Learnings migrated from local JSON to `learnings` table
- Row Level Security (RLS) applied to all tables
- Realtime subscriptions used for dashboard live updates

### Security

- User passwords for Workday/job platforms must be stored encrypted in Supabase
- Bot accesses secrets via environment variables only
- No secrets in code or git history
- Dashboard auth via Supabase Auth (email/password or magic link)

### Error Handling and Reliability

- All Playwright operations wrapped in try/catch with fallbacks
- Validation errors on Workday wizard trigger re-fill pass before re-advancing
- "Stuck on same step" detection (3 identical iterations → bail)
- Application status written to database on all terminal states (submitted, failed, skipped)
- Screenshots taken at key steps for debugging

### Resume Parsing (V1+)

- Parse resume PDF to extract text content
- Extract specific answers for unmapped fields
- **Answer persistence:** All resume-parsed answers must be stored in `profile.yml` (V1) or Supabase (V2+) for future reuse
- Fallback: if answer is not in profile or resume, trigger Telegram fallback Q&A

---

## External API Dependencies

| API | Purpose | Credentials Required |
|---|---|---|
| Telegram Bot API | Job confirmation messaging & Q&A fallback | Bot token (BotFather) |
| Supabase REST / Realtime | Database reads/writes + live updates | Project URL + Anon/Service Key |
| Playwright / Chromium | Browser automation | None (local install) |

---

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Application completion rate | ≥80% for supported ATS platforms |
| Telegram confirmation latency | Message sent within 10s of job being picked up |
| Queue processing | Sequential per user; parallel across users via isolated browser workers |
| Worker concurrency | One worker per user running concurrently in parallel (e.g., 3 users = 3 parallel workers) |
| Max concurrent users | ~10 (V2) |
| Bot restart recovery | Resume from last incomplete job on restart |
| Screenshot storage | Retained per run for debugging |
| Log retention | Last 200 application results in learnings store |
