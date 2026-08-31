# STATE.md

## Current Phase
- Phase V1-A5 — Side A interface functions (Side A) [DONE]

## Completed Phases
- MVP done
- Phase V1-A1 — Schema migration + profile extension (Side A)
- Phase V1-A2 — Extend onboarding screen + API (Side A)
- Phase V1-A3 — Monitoring UI screen & Interventions (Side A)
- Phase V1-A4 — Telegram job confirmation state machine & matching design (Side A)
- Phase V1-A5 — Side A interface functions (Side A)

## Current Blockers
- None

## Last Commit Summary
- V1-A5: add migration 20260831000005 for profile_daily_action_counts table + check_and_increment_action_count RPC (300/day limit), implement all 8 Side A interface functions in worker/sideA.js (getProfile, getResumeUrl, claimNextJob, markJobStatus, createIntervention, resolveIntervention, storeJobsFromScrape, checkAndIncrementActionCount), wire bot/src/stubs/sideA.js dynamic import bridge, and add test-a5-harness.js.

## Next Action
- Phase V1-A6 Plan mode: outline local worker loop orchestration (`worker/index.js`, `worker/healthLoop.js`, `worker/scrapeLoop.js`, `worker/applyLoop.js`) per `06-implementation.md` and `07-workflow-side-a.md`.
