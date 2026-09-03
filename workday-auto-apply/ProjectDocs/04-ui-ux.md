# UI/UX — Monitoring Dashboard

## Overview

The initial UI is a simple, internal monitoring dashboard. Its purpose is to let an administrator or user:

1. Add and manage user profiles
2. Insert job links for processing
3. Monitor bot activity and application status in real time
4. View errors, fallbacks, and automation events

The dashboard is **not** a consumer-facing product in V0–V2. It is a practical internal tool built for clarity and utility over visual polish.

---

## Design Principles

- **Information density over decoration** — show exactly what the bot is doing, clearly
- **Status at a glance** — every screen should answer "what is happening right now?"
- **Minimal interaction** — users add profiles and links; the bot does the work
- **Error visibility** — failures and unmapped fields should be immediately obvious
- **Progressive disclosure** — simple view by default, detail available on demand

---

## Screens

### Screen 1 — Dashboard Home (Bot Monitor)

The primary screen. Shows the current state of the bot and all active jobs.

```
┌─────────────────────────────────────────────────────────────────┐
│  🤖 Auto-Apply Bot          [All Users ▾]        [+ Add Job]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  BOT STATUS                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🟢 Running    Current Job: Software Engineer @ Google   │    │
│  │  Step: My Experience (3/5)    Started: 2 min ago         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  JOB QUEUE                                                        │
│  ┌────┬──────────────────┬──────────────┬───────────┬──────┐   │
│  │ #  │ Job              │ Company      │ Status    │ ATS  │   │
│  ├────┼──────────────────┼──────────────┼───────────┼──────┤   │
│  │ 1  │ Software Eng.    │ Google       │ 🔵 Applying│ WD  │   │
│  │ 2  │ ML Engineer      │ OpenAI       │ ⏳ Pending │ GH  │   │
│  │ 3  │ Backend Eng.     │ Stripe       │ ⏳ Pending │ LV  │   │
│  │ 4  │ SWE Intern       │ Meta         │ ✅ Submitted│ WD  │   │
│  │ 5  │ Platform Eng.    │ Cloudflare   │ ❌ Failed  │ GH  │   │
│  └────┴──────────────────┴──────────────┴───────────┴──────┘   │
│                                                                   │
│  RECENT EVENTS                                                    │
│  09:14 ✅ Filled: First Name ← "Yaswanth"                        │
│  09:14 ✅ Uploaded resume: resume-swe.pdf                         │
│  09:13 ➡️  Advancing: Save and Continue (Step 3 → 4)             │
│  09:12 ⚠️  Unmapped: "Describe your motivation" [textarea]        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- **Bot Status Card** — current state (Running/Idle/Error), current job, current step
- **Job Queue Table** — all jobs with status badges and ATS identifier
- **Recent Events Log** — live-streaming automation events (fill actions, advances, errors)

**Status badges:**
- 🔵 Applying
- ⏳ Pending (awaiting Telegram confirmation or start)
- ✅ Submitted
- ❌ Failed
- ⏭ Skipped (user said No in Telegram)

---

### Screen 2 — Add Job

Modal or side panel triggered by "+ Add Job" button.

```
┌─────────────────────────────────────────────┐
│  Add Job Link                          [✕]  │
├─────────────────────────────────────────────┤
│                                             │
│  Job URL                                    │
│  ┌─────────────────────────────────────┐   │
│  │ https://careers.google.com/jobs/...  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  User         [Yaswanth Naidu ▾]           │
│                                             │
│  Company (optional)                         │
│  ┌─────────────────────────────────────┐   │
│  │ Google                               │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  Notes (optional)                           │
│  ┌─────────────────────────────────────┐   │
│  │                                      │   │
│  └─────────────────────────────────────┘   │
│                                             │
│              [Cancel]   [Add to Queue]      │
│                                             │
└─────────────────────────────────────────────┘
```

**Fields:**
- Job URL (required) — validates it is a valid URL
- User — dropdown of registered users
- Company — auto-filled from URL where possible
- Notes — freeform

---

### Screen 3 — User Profiles

List of all registered users with their bot and queue status.

```
┌─────────────────────────────────────────────────────────────────┐
│  Users                                          [+ Add User]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┬────────┬──────────┬──────────┬──────┐    │
│  │ Name             │ Email  │ Queue    │ Applied  │      │    │
│  ├──────────────────┼────────┼──────────┼──────────┼──────┤    │
│  │ Yaswanth Naidu   │ g...   │ 3 pending│ 12 total │ Edit │    │
│  │ Jane Doe         │ j...   │ 0 pending│ 5 total  │ Edit │    │
│  └──────────────────┴────────┴──────────┴──────────┴──────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

### Screen 4 — Add / Edit User Profile

Full profile form. This is the primary data entry screen. Information saved here becomes the source of truth for all applications.

```
┌─────────────────────────────────────────────────────────────────┐
│  Add User Profile                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  PERSONAL INFORMATION                                             │
│  First Name          Last Name                                    │
│  [              ]    [              ]                             │
│                                                                   │
│  Email               Phone                                        │
│  [              ]    [              ]                             │
│                                                                   │
│  LinkedIn URL                                                     │
│  [                                       ]                        │
│                                                                   │
│  Location (City, State)                                           │
│  [                                       ]                        │
│                                                                   │
│  Country             Postal Code                                  │
│  [              ]    [              ]                             │
│                                                                   │
│  ─────────────────────────────────────                            │
│  EDUCATION                                                        │
│  Degree              Major                                        │
│  [              ]    [              ]                             │
│                                                                   │
│  University          Graduation Year                              │
│  [              ]    [              ]                             │
│                                                                   │
│  ─────────────────────────────────────                            │
│  EXPERIENCE                                                       │
│  Current Company     Current Title                                │
│  [              ]    [              ]                             │
│                                                                   │
│  Years of Experience Salary Expectation                           │
│  [              ]    [              ]                             │
│                                                                   │
│  ─────────────────────────────────────                            │
│  WORK AUTHORIZATION (US)                                          │
│  Authorized to work?  [Yes ▾]                                     │
│  Sponsorship needed?  [No ▾]                                      │
│  Willing to relocate? [Yes ▾]                                     │
│  Office/hybrid OK?    [Yes ▾]                                     │
│                                                                   │
│  ─────────────────────────────────────                            │
│  EEO / VOLUNTARY DISCLOSURES                                      │
│  Gender              Race/Ethnicity                               │
│  [              ]    [              ]                             │
│                                                                   │
│  Veteran Status      Disability Status                            │
│  [              ]    [              ]                             │
│                                                                   │
│  ─────────────────────────────────────                            │
│  CREDENTIALS                                                      │
│  Workday Email       Workday Password                             │
│  [              ]    [••••••••••••]                               │
│                                                                   │
│  OTP Email (Gmail)   Gmail App Password                           │
│  [              ]    [••••••••••••]                               │
│                                                                   │
│  ─────────────────────────────────────                            │
│  TELEGRAM                                                         │
│  Telegram Chat ID                                                 │
│  [              ]                                                 │
│                                                                   │
│  ─────────────────────────────────────                            │
│  RESUME                                                           │
│  [Upload PDF]   resume-swe.pdf ✅                                 │
│                                                                   │
│              [Cancel]              [Save Profile]                 │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Sections:**
- Personal Information
- Education
- Experience
- Work Authorization
- EEO / Voluntary Disclosures
- Credentials (Workday + Gmail/OTP)
- Telegram Chat ID
- Resume upload

---

### Screen 5 — Job Detail View

Expanded view of a single job's application history and events.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back    Software Engineer — Google                  [Retry]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  URL: https://careers.google.com/...                             │
│  ATS: Workday    User: Yaswanth Naidu    Added: Sep 3, 2026      │
│                                                                   │
│  STATUS: ✅ Submitted — Sep 3, 2026 09:22                        │
│                                                                   │
│  APPLICATION STEPS                                                │
│  ✅ Telegram Confirmed     09:10                                  │
│  ✅ Scan Complete          09:11  (18 fields detected)           │
│  ✅ Plan Generated         09:11  (16 fills, 1 unmapped)         │
│  ✅ My Information         09:14  (step 1/5)                     │
│  ✅ My Experience          09:16  (step 2/5, resume uploaded)    │
│  ✅ Application Questions  09:18  (step 3/5)                     │
│  ✅ Voluntary Disclosures  09:20  (step 4/5)                     │
│  ✅ Review + Submit        09:22  (confirmed)                    │
│                                                                   │
│  UNMAPPED FIELDS                                                  │
│  ⚠️  "Describe your motivation" [textarea] — no match in profile │
│                                                                   │
│  SCREENSHOT                                                       │
│  [post-submit-2026-09-03.png] [View]                             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Inventory

| Component | Used In | Description |
|---|---|---|
| `BotStatusCard` | Dashboard | Current bot state, job, step, elapsed time |
| `JobQueueTable` | Dashboard | Paginated list of jobs with status badges |
| `EventLog` | Dashboard | Auto-scrolling live event stream |
| `AddJobModal` | Dashboard | Modal form to add a job URL |
| `UserTable` | Users | List of registered users |
| `UserProfileForm` | Add/Edit User | Full profile data entry form |
| `JobDetailView` | Job Detail | Application step history, unmapped fields, screenshot |
| `StatusBadge` | Queue, Detail | Color-coded status indicator |
| `ATSBadge` | Queue | Small label showing ATS platform |
| `ErrorPanel` | Dashboard, Detail | Highlighted error and fallback messages |
| `Sidebar` | All screens | Navigation: Dashboard, Users, Settings |

---

## Navigation Structure

```
App
├── / Dashboard (Bot Monitor)
│     ├── [+ Add Job] → AddJobModal
│     └── [Job row] → Job Detail
├── /users User Profiles
│     ├── [+ Add User] → Add User Profile
│     └── [Edit] → Edit User Profile
├── /jobs/:id Job Detail
└── /settings Settings (credentials, Telegram config)
```

---

## Interaction States

| State | Visual Treatment |
|---|---|
| Bot idle | Grey status indicator, "Idle" label |
| Bot running | Green pulsing indicator, current step shown |
| Bot error | Red indicator, error message in event log |
| Job pending | Grey ⏳ badge |
| Job applying | Blue animated 🔵 badge |
| Job submitted | Green ✅ badge |
| Job failed | Red ❌ badge with error tooltip |
| Job skipped | Grey ⏭ badge |
| Telegram waiting | Yellow ⏳ badge with "Awaiting confirmation" label |

---

## Real-Time Behavior (V2+)

- Bot events stream into the Event Log as they happen via Supabase Realtime
- Job status updates in the queue table without page refresh
- Bot Status Card updates live as steps progress
- No manual refresh needed for any status information
