# PRD — Handshake Auto-Apply Bot (MVP)

## Problem Statement
Students on Handshake-eligible campuses manually re-enter the same profile data across job platforms and repeat the same clicks (quick apply, document selection, screening questions) for every job. This MVP proves that a browser-automation bot, seeded from a short in-app onboarding form, can authenticate to Handshake and submit a job application on the user's behalf without live supervision.

## Target Users
- Students who have a Handshake account (or are eligible to create one) and want to test automated applying via a single job link.
- Internal team (this internship): validating the bot mechanics before building the full app around it.

## Goals / Non-Goals

**Goals**
- Prove Supabase-collected onboarding answers can drive a real Handshake signup/login.
- Prove the bot can complete a full apply flow (quick apply or apply) on one submitted job link.
- Prove the human-in-the-loop fallback (live handoff, Telegram) works end-to-end at least once each.

**Non-Goals (this phase)**
- Full React Native onboarding UI/UX polish — minimal screens only.
- Job discovery/scraping from Handshake — out of scope for the entire build; only the manually-submitted job link is used.
- Multi-job or batch applying — one job link, one apply run.
- n8n or any external orchestration tool — Vercel Workflows only.
- Partnered-college eligibility gating — deferred; MVP triggers the bot unconditionally after onboarding.

## Core Features

| Feature | Description | Priority |
|---|---|---|
| Minimal onboarding form | Collects the fixed field set (below) into Supabase | P0 |
| Resume upload | PDF <1MB → Supabase Storage, linked to user | P0 |
| Telegram account linking | User connects to the single app-level Telegram bot; `chat_id` stored against profile | P0 |
| Gmail OAuth consent (readonly) | Conditional — only shown if existing-account = Yes; per-user OAuth, not a password | P0 |
| Handshake auth automation | Branch: new account creation (No) vs OTP login (Yes) | P0 |
| Job-link-triggered apply run | Submitting the Handshake job link kicks off the full bot workflow | P0 |
| Quick Apply / Apply logic | Prefer Quick Apply when both are present; else Apply | P0 |
| Document upload via "Upload new" | Always attaches the Supabase-stored resume, never picks an existing dropdown entry | P0 |
| Dynamic Q&A capture | Unanswered application questions/documents → Telegram request → stored in Supabase for reuse | P0 |
| Live handoff | Embedded live browser view for unhandled/blocking steps (e.g. email verification) | P0 |
| Read-only OTP automation | Gmail API (readonly scope) reads Handshake OTP for existing-account login | P0 |
| Safe exit | Bot cleanly ends session after signup/apply completes | P0 |
| Daily report email | Jobs applied count + prior-application updates, via Resend | P1 |

## Success Metrics
- **Leading:** one full signup-or-login run completes without an unrecoverable error; one full apply run submits successfully on a real job link.
- **Leading:** at least one live-handoff pause/resume and one Telegram fallback exchange complete successfully during testing.
- **Lagging:** stored answers/documents are reused automatically on a second application without re-prompting the user.

## Constraints / Assumptions
- Stack: React Native + Supabase (app/data), Vercel + Vercel Workflows (orchestration, TypeScript), Playwright (bot), Telegram Bot API, Gmail API (readonly), Resend (email). No paid tools beyond Cursor Pro.
- Handshake has no public API; all interaction is browser automation and may violate Handshake's Terms of Service. Mitigation for this phase: hard rate limit of 300 actions/day. No other mitigation scoped yet.
- `gmail.readonly` is a Google restricted scope. This phase stays in Google's "Testing" OAuth publishing status with test accounts explicitly allowlisted — no verification needed at this scale. Production rollout beyond allowlisted testers requires Google app verification + an annual CASA security assessment; not scoped this phase.
- Deployment target: Vercel only (Hobby plan) for this phase.
- RLS required on all Supabase tables holding personal data, credentials, or documents.
