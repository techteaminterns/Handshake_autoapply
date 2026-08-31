# AGENTS.md

## Workflow Rules
- Smallest diff that satisfies the current phase's checkpoint — no speculative scope.
- Test before marking any slice done: self-run the checkpoint from `06-implementation.md` for the current phase.
- No silent dependencies — flag any new package before adding it; nothing paid beyond what's already approved.
- Ask if ambiguous — do not guess at Handshake selectors, field mappings, or DB queries; check `03-workflow.md` / `05-backend-schema.md` first, ask if still unclear.
- Update docs (README/docstrings) as part of finishing each slice, before moving to the next phase.
- Update STATE.md at every commit — fill Current Phase, Last Commit Summary, and Next Action before pushing.

## Code Generation Tools
- Cursor Pro and Antigravity CLI (agy) are both approved code generation tools. Use Plan mode first in both, Agent mode only after reviewing diff.
- Fresh Cursor / Antigravity chat at the start of each phase and after the integration pass.

## Project-Specific Rules
- All Playwright code lives in `bot/` (Side B). No Playwright imports in `api/` or `worker/`.
- All worker orchestration lives in `worker/` (Side A). Worker runs as a local Node.js process until Vercel Workflows phase.
- No `setTimeout` polling inside Playwright steps — use Playwright's built-in `waitFor*` methods.
- Every Supabase table touching personal data, credentials, resumes, or Q&A history must have RLS enabled before it is used by any API route.
- `handshake_password_enc` is encrypted at rest (AES-256-GCM) and never returned to the client in any API response or log.
- Resume upload: always "Upload new" in Handshake. Never select from an existing dropdown.
- SUBMITTED is written to `applications` only after a positive DOM success confirmation is observed. Never assume success from a click.
- `claimNextJob` must use the atomic RPC (`claim_next_job` Postgres function with FOR UPDATE SKIP LOCKED). Never claim with two separate SELECT + UPDATE operations.
- Enforce the 300-actions/day rate limit via `checkAndIncrementActionCount` before each Handshake action.
- `safeExit` must be called on every exit path in every bot function — success, failure, and unhandled exceptions.
- Telegram bot token is an app-level secret in Vercel env vars. Never collected from or exposed to end users.
- No Vercel Workflows code until Phase V1-A7. Local worker process is the runtime for all earlier phases.
- The eight docs (`01`–`08`) + this file are the fixed spec. If implementation reveals the docs are wrong or incomplete, stop and flag it — don't silently deviate.

## .cursor/rules/ Files
- `app.mdc` — RN/Expo conventions, Supabase client usage, env var access via EXPO_PUBLIC_*
- `bot-playwright.mdc` — Playwright patterns, persistent context, waitFor usage, safeExit requirement
- `supabase.mdc` — RLS enforcement, service-role vs anon key usage, migration workflow (always include `supabase db push`)
- `worker.mdc` — local worker loop patterns, interval management, sequential job processing, stub/real function wiring
