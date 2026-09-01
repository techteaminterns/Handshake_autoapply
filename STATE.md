# STATE.md

## Current Phase
- Phase V1-A6 — Local worker loop (Side A) & End-to-End Testing

## Completed Phases
- MVP done
- Phase V1-A1 — Schema migration + profile extension (Side A)
- Phase V1-A2 — Extend onboarding screen + API (Side A)
- Phase V1-A2-Ext — Resume PDF extraction & auto-fill (Side A)
- Phase V1-A3 — Monitoring UI screen & Interventions (Side A)
- Phase V1-A4 — Telegram job confirmation state machine & matching design (Side A)
- Phase V1-A5 — Side A interface functions (Side A)
- Phase V1-A6 — Local worker loop (Side A)

## Current Blockers
- None

## Last Commit Summary
- Hardened bot and worker application status transitions:
  - Ensured sequential `SUBMITTING` -> `SUBMITTED` status updates in `bot/src/flows/applyToJob.js` and `worker/sideB.js` to adhere to Side A schema constraints.
  - Added `.gitignore` exclusions for `sessions/`, test screenshots, and test resume artifacts.
  - Added end-to-end orchestration tests `test-orchestration-full-flow.js` and `test-telegram-to-mock-apply.js`.

## Next Action
- Commit Phase V1-A2-Ext resume PDF extraction & auto-fill feature.

