# PRD — OneClickHandshake V1

## Problem Statement
Students manually apply to jobs repeatedly across platforms. This V1 proves a bot can scrape Handshake jobs matching user preferences, ask for confirmation via Telegram, and apply automatically — with the user only intervening for OTPs and confirmations through a monitoring UI.

## Target Users
- Students with or without an existing Handshake account
- Internal test user (Sato) until student email is obtained

## Goals / Non-Goals

**Goals**
- Bot signs into Handshake using stored credentials; handles sign-up for new users
- Bot scrapes jobs daily filtered by user preferences
- User confirms each job via Telegram before bot applies
- Bot applies sequentially, one job at a time
- User handles OTPs and email confirmations via popup in monitoring UI
- Monitoring UI in RN app shows bot status, job queue, intervention popups

**Non-Goals**
- Multi-user / multi-candidate (V1 = one test user)
- Parallel job applications
- Resume tailoring per job
- Daily report emails
- Vercel Workflows (last phase only, may slip to V2)
- Browserless.io (local Playwright only for V1)
- Gmail OAuth
- Live handoff embed

## Core Features

| Feature | Description | Priority |
|---|---|---|
| Extended onboarding | Collect all user prefs + Handshake account status, store to DB | P0 |
| Telegram linking | Link user's Telegram chat_id on onboarding | P0 |
| Handshake sign-in | Bot signs in using stored profile; OTP via monitoring UI popup | P0 |
| Handshake sign-up | Bot creates account for new users; email confirm + phone OTP via popup | P0 |
| Daily job scrape | Bot scrapes Handshake once/day filtered by user preferences | P0 |
| Session health check | Every 30 mins, verify bot is still logged into Handshake | P0 |
| Telegram job confirmation | Bot sends job to user via Telegram; yes → apply, no → permanent reject | P0 |
| Sequential apply | Quick Apply preferred; resume from Supabase; unknown questions → NEEDS_INPUT | P0 |
| Submission verification | SUBMITTED written only after positive DOM confirmation | P0 |
| Monitoring UI | RN screen: bot status, job queue, OTP popups, intervention handling | P0 |
| Duplicate protection | Same user/job pair cannot be applied to twice | P0 |
| Vercel Workflows migration | Migrate local worker to durable cloud execution | P3 (last phase, may slip to V2) |

## Success Metrics
- **Leading:** bot completes sign-in and applies to one real Handshake job end-to-end without error
- **Leading:** Telegram yes/no confirmation loop works; rejected jobs permanently skipped
- **Leading:** OTP popup in monitoring UI successfully passes OTP to bot
- **Lagging:** bot processes a daily scrape, queues jobs, and applies to confirmed ones unattended

## Constraints / Assumptions
- Stack: RN/Expo, Supabase, Vercel API routes, local Playwright, Telegram Bot API
- No paid tools beyond Cursor Pro
- Student email with real Handshake account needed for scraping + real sign-in testing — expected within days
- Whether Handshake jobs page requires login to scrape is unknown until student email obtained
- V1 = one user (Sato); multi-user architecture deferred
- All bot orchestration runs locally (laptop on) until Vercel Workflows phase
- Side A (Sato) owns infra/app/orchestration; Side B (teammate) owns all Playwright code
