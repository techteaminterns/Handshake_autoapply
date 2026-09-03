# PRD — Job Application Automation Bot

## Problem Statement

Applying to jobs is time-consuming and repetitive. Most job application platforms require the same personal, educational, and work authorization information — filled out over and over in different forms. This project builds an automation bot that handles the entire application process: receiving job links, confirming intent with the user via Telegram, and applying automatically using stored profile data.

The existing `auto-apply` codebase provides a working single-user CLI automation engine for Workday, Greenhouse, Lever, Ashby, and other ATS platforms. The product evolution builds on this core to add confirmation workflows, multi-user support, a monitoring dashboard, and production deployment.

---

## Target Users

- **Job seekers** who apply to many jobs and want to reduce repetitive manual effort
- **Power users** comfortable providing profile information upfront and trusting bot-driven automation
- **Administrators** managing a small set of users through a dashboard (V2+)

---

## Goals / Non-Goals

### Goals

- Bot receives job links and applies automatically after user confirmation
- User confirms each job via Telegram before the bot applies
- Bot handles sign-in or sign-up to job platforms as required
- Bot scans the application form, plans answers, and fills all fields
- Bot repeats across form steps until submission is complete
- For unanswerable fields: bot asks user via Telegram, stores the answer for future reuse
- Dashboard allows managing users, inserting job links, and monitoring bot activity
- Each user has a dedicated worker; all workers run in parallel (one worker per user)
- Each worker processes that user's queue sequentially — one job at a time, isolated browser per job
- System supports multiple users with per-user job queues (V2+)
- All user data stored in Supabase (V2+)
- Deployed reliably via Docker + Railway (V3+)

### Non-Goals

- Discovering or scraping job listings automatically (bot only processes provided links)
- Parallel job applications within a single user's queue (each worker is sequential per user)
- AI-generated resume tailoring per job
- OAuth-based Gmail integration (not in scope)
- Public-facing user registration or self-service signup

---

## Core Product Requirement

> Build an automation bot that receives job links, asks the user for confirmation through Telegram, and applies to the job only after the user confirms.

---

## Core Features by Version

### V0 — Core Automation (Existing, Stabilized)

| Feature | Description | Priority |
|---|---|---|
| Terminal-triggered application | Run `node cli.mjs apply <url>` to start full pipeline | P0 |
| ATS detection | Auto-detect Greenhouse, Lever, Ashby, Workday, Gem, Generic | P0 |
| Form scanning | Extract all fields from application form DOM | P0 |
| Plan generation | Map field labels to profile.yml values via FIELD_MAP | P0 |
| Form fill | Fill all field types: text, select, radio, checkbox, file, yes-no-button | P0 |
| Workday wizard | Navigate 5-step Workday wizard automatically | P0 |
| Workday sign-in | Log in to Workday with stored credentials | P0 |
| Workday sign-up | Create new Workday account + handle email verification OTP | P0 |
| OTP handling | Detect OTP prompt; ask user in terminal to enter code; bot fills field | P0 |
| Resume upload | Upload PDF resume during application | P0 |
| Self-learning | Record field corrections, apply on future runs | P1 |
| Queue management | Add/list/process URLs from queue CSV | P1 |

### V1 — Telegram Approval + Multi-Job Flow

| Feature | Description | Priority |
|---|---|---|
| Telegram confirmation | Send job info to user via Telegram; Yes = apply, No = skip | P0 |
| Interactive Yes/No buttons | Telegram inline keyboard buttons for confirmation | P0 |
| Sequential multi-job | Process up to 20 jobs sequentially per user | P0 |
| Resume parsing | Extract resume content to answer questions not in profile | P1 |
| Resume answer storage | Store resume-derived answers to profile/DB for future reuse | P1 |
| Telegram Q&A fallback | For unanswerable questions, bot asks user via Telegram; stores answer for reuse | P1 |
| Job info extraction | Extract job title, company, location from URL/page before confirmation | P1 |

### V2 — Supabase + Multi-User + Monitoring Dashboard

| Feature | Description | Priority |
|---|---|---|
| User management | Add users via dashboard form with full profile info | P0 |
| Supabase storage | All user profiles, jobs, queues in Supabase | P0 |
| Job link input | Submit job links via dashboard; stored in Supabase jobs table | P0 |
| Per-user job queue | Each user's queue processes sequentially within their dedicated worker | P0 |
| Parallel worker pool | One worker per user; workers run in parallel; isolated browser per job | P0 |
| Live monitoring dashboard | Show bot activity, job status, errors, fallbacks | P0 |
| Multi-user support | Support ~10 concurrent users (one worker each) | P0 |
| Application status tracking | Track each job: pending, confirmed, applying, submitted, failed | P0 |
| Telegram workflow integration | Telegram confirmation + Q&A fallback flows through Supabase | P1 |

### V3 — Deployment Infrastructure

| Feature | Description | Priority |
|---|---|---|
| Docker containerization | Package bot + dependencies into container | P0 |
| Railway deployment | Deploy bot worker on Railway | P0 |
| Headless browser support | Run Chromium headlessly in container environment | P0 |
| Environment management | Secure secrets via Railway environment variables | P0 |

### V4 — Full Product Website

| Feature | Description | Priority |
|---|---|---|
| Public product website | Landing page, feature showcase, pricing/plans | P1 |
| User onboarding flow | Guided setup: profile → Telegram → first job | P1 |
| Analytics | Application success rates, ATS coverage, time saved | P2 |
| Expanded ATS support | Add more ATS platforms based on user demand | P2 |

---

## Success Metrics

- **V0:** Bot completes end-to-end application on Workday and Greenhouse without manual intervention
- **V1:** Telegram Yes/No loop works; bot applies only after confirmation; 20 jobs processable in sequence
- **V2:** 10 users can each have job queues; dashboard shows live status; Supabase is the single source of truth
- **V3:** Bot runs reliably on Railway without local machine; applications complete in cloud environment
- **V4:** Defined based on product direction after V3

---

## Constraints and Assumptions

- The existing `auto-apply` codebase is the source of truth for current automation behavior
- Workday is the primary and most complex ATS platform in scope
- One job is processed at a time per user (sequential within each user's queue, but multiple workers run in parallel across users, each using an isolated browser)
- Users provide job links manually (no automated scraping in scope)
- For versions before the monitoring dashboard (V0/V1), OTPs are requested directly via terminal prompt and filled character-by-character; no Google/Gmail IMAP retrieval needed
- Answer resolution cascade: profile data → parsed resume answers → Telegram Q&A fallback (bot asks user). All new answers from resume and Telegram are stored for future reuse (in profile.yml before Supabase integration, then Supabase in V2+)
- The dashboard is an admin/internal tool, not a public consumer product (V0–V3)
- Stack: Node.js, JavaScript/TypeScript, Playwright, Supabase, Telegram Bot API, Railway, Docker
