---
description: React Native app and onboarding conventions
globs: app/**, screens/**, components/**
alwaysApply: false
---

# App (React Native) rules

- Screens and field sets follow `04-ui-ux.md` and `01-prd.md` exactly — no extra fields, no dropped fields, no renaming without updating the docs first.
- The app never talks to Supabase tables requiring service-role access directly. All writes to `profiles`, `resumes`, `bot_runs`, `gmail_oauth_tokens` go through the Vercel API routes in `05-backend-schema.md`, using the anon key + RLS.
- Onboarding form state: keep all fields in one client-side draft object until final submit — no partial writes to Supabase mid-form except the resume file itself (uploaded to Storage as soon as selected, not deferred to final submit).
- Resume and any other document upload: enforce <1MB and PDF type client-side before upload, in addition to the API-layer check — never rely on only one layer.
- "Link Telegram" and "Connect Gmail" are both external-redirect flows (deep link / OAuth redirect) — do not attempt to collect a token, password, or API key from the user for either. If a task seems to require asking the user for a Telegram or Google credential directly, stop and flag it — that's a sign the flow is being built wrong.
- "Connect Gmail" only renders when `has_existing_handshake_account = true`. Do not show it unconditionally.
- Bot Status screen must poll or subscribe to `bot_runs.status` — never assume a fixed duration or timeout for a run, since live-handoff and Telegram pauses can last indefinitely.
- Keep this phase's UI minimal per `04-ui-ux.md`'s design notes — no design system work, no component library beyond RN defaults, until a later phase explicitly scopes it.
