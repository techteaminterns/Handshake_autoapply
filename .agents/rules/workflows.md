---
description: Vercel Workflows orchestration conventions
globs: workflows/**, api/bot/**
alwaysApply: false
---

# Workflows (Vercel Workflows) rules

- All bot orchestration is a durable Vercel Workflow (`'use workflow'` at the workflow entry, `'use step'` for each discrete unit of work). Never write a bare long-running function, a manual polling loop, or a `setTimeout`-based wait for bot orchestration — that defeats the reason Workflows was chosen over an external queue.
- Long waits (live handoff, Telegram reply, OTP arrival) are workflow-level pauses via hooks/`sleep`, not in-function loops. A step should either complete or hand off to a pause — it should never sit spinning waiting for an external event.
- Each individual step must complete within Vercel's Hobby function duration limit (300s). If a step is at risk of running long, split it into smaller steps rather than trying to extend the duration.
- Every workflow run's `workflow_run_id` is written to `bot_runs.workflow_run_id` at start, and `bot_runs.status` is kept in sync at every step transition (`running`, `paused_live_handoff`, `paused_telegram`, `succeeded`, `failed`) — the app's Bot Status screen depends on this being accurate in near-real-time, not just at the end.
- The `authenticate` step branches on `profiles.has_existing_handshake_account`: `createAccount` (false) or `otpLogin` (true). Don't merge these into one code path — they have different pause points and different failure modes.
- Resume hooks (`/api/bot/live-handoff/resume`, Telegram webhook resume) must validate they're resuming the correct paused run (`workflow_run_id` match) before signaling — never resume based on user/profile ID alone.
- No use of Upstash, n8n, or any external queue/orchestration service for this project. If a task seems to need one, stop and flag it rather than adding a new service quietly.
