# AGENTS.md

## Workflow rules
- Smallest diff that satisfies the current phase's checkpoint — no speculative scope.
- Test before marking any slice done: self-run the checkpoint from `06-implementation.md` for the current phase.
- No silent dependencies — flag any new package before adding it; nothing paid beyond what's already approved (Cursor Pro is the only paid tool in this project).
- Ask if ambiguous — do not guess at Handshake selectors, field mappings, or workflow branching; check against `03-workflow.md` / `05-backend-schema.md` first, ask the user if still unclear.
- Update docs (README/docstrings) as part of finishing each slice, before moving to the next phase.

## Project-specific rules
- All bot orchestration lives inside Vercel Workflow (`'use workflow'` / `'use step'`) — never a bare `setTimeout`, long-running function, or manual polling loop outside a workflow step. Long waits (live handoff, Telegram reply, OTP) are workflow-level pauses, not in-function loops.
- Browser automation uses `playwright-core` + `@sparticuz/chromium` only — never full Playwright-bundled Chromium in a deployed function (breaks the 250MB bundle limit).
- Every Supabase table touching personal data, credentials, resumes, or Q&A history must have RLS enabled before it's used by any API route.
- Never persist Handshake or email passwords in plaintext. OTP flow uses Gmail readonly OAuth, not stored credentials, wherever the design calls for it.
- Telegram bot token and Google OAuth Client ID/secret are app-level secrets set once by the developer (BotFather / Google Cloud Console — manual, not automatable) and stored as Vercel env vars. Never collected from, or exposed to, end users. Per-user linkage is `chat_id` (Telegram) and a refresh token obtained via standard OAuth consent redirect (Gmail) — never raw credentials.
- Gmail refresh tokens (`gmail_oauth_tokens.refresh_token`) are encrypted at rest and never returned to the client, in an API response, or in logs.
- Resume upload: always "Upload new" + the Supabase-stored file. Never select an existing document from a Handshake dropdown.
- Enforce the 300-actions/day bot rate limit via `bot_runs.actions_count` — halt and log, don't silently retry past it.
- The six docs (`01`–`06`) are the fixed spec. If implementation reveals the docs are wrong or incomplete, stop and flag it — don't silently deviate from what's written.
