---
description: Playwright bot automation conventions
globs: bot/**, workflows/steps/**
alwaysApply: false
---

# Bot (Playwright) rules

- Use `playwright-core` + `@sparticuz/chromium` only. Never install or import full Playwright-bundled Chromium in code that ships to a deployed function — it breaks Vercel's 250MB bundle limit and won't be caught until deploy time if introduced quietly.
- Quick Apply vs Apply: if both are present on a job page, always choose Quick Apply. Never default to Apply when Quick Apply exists.
- Document selection during apply: always use "Upload new," never pick an existing dropdown entry — even if one looks like a match. This applies to the resume and to any other requested document.
- All documents (resume included) are <1MB. Don't write upload logic that assumes a larger limit anywhere in the bot.
- Every question encountered during apply: check `reusable_answers` (scoped to the current `profile_id`) before ever triggering the Telegram fallback. Never prompt the user for something already on file.
- The Handshake network-connections prompt during account creation: always select "Maybe later." Don't build a step that tries to interpret or act on it differently.
- Every branch — success or failure — must end by calling the `safeExit` step. No branch should leave a browser session open, including on unhandled errors; wrap steps so failures still reach `safeExit`.
- Check `bot_runs.actions_count` against the 300/day cap before taking a Handshake action. On hitting the cap: halt, log the reason, do not retry or queue past it.
- Don't invent new Handshake selectors or flows beyond what `03-workflow.md` specifies. If Handshake's actual UI doesn't match what the doc describes, stop and flag it rather than improvising a workaround.
