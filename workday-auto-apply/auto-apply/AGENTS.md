# AGENTS.md — Workday Auto-Apply Bot

## Workflow Rules

- **Smallest diff per phase** — no speculative scope, no future-proofing
- **Test before marking done** — self-run checkpoint from implementation plan; no silent assumptions  
- **No paid tools beyond agy subscription** — flag any external API before adding
- **Ask if ambiguous** — do not guess at Workday selectors, page flow, or code behavior; check source or ask
- **Source of truth** — use CODEBASE-ANALYSIS.md as the source of truth in case anything is unclear
- **Update STATE.md after every commit** — auto-update project state tracking (see rule below)
- **Always update CODEBASE-ANALYSIS.md at every commit** — keep the analysis report in sync with actual code (see rule below)
- **Git discipline** — one commit per vertical slice; branch name reflects slice; commit message clear

## Code Generation Tool

**Antigravity CLI (agy)** is the sole code generation tool.

### Workflow per slice
1. **Plan mode** (`agy /grill`) — clarify architecture, dependencies, page flow if unclear
2. **Diff review** (`agy /diff`) — inspect output before commit
3. **Agent mode** (`agy` default) — implement, test locally, commit
4. **Fresh agy chat** at start of major phases (pre-scan auth, multi-step wizard, etc.)

## State Auto-Update Rule

**After every commit:**
1. Run: `agy @workday-auto-apply/lib @workday-auto-apply/cli.mjs "Summarize current working features, broken features, and next blockers from this code."`
2. Paste agy summary into STATE.md under **Current Status** section
3. Commit STATE.md update: `git add STATE.md && git commit -m "[State] Updated after [feature-branch] commit"`

This keeps STATE.md canonical without manual tracking.

## Codebase Analysis Auto-Update Rule

**After every commit** that changes any file inside `lib/`, `cli.mjs`, or `config/`:
1. Update `CODEBASE-ANALYSIS.md` to reflect what changed:
   - If a module's behavior changed → update the relevant section (e.g., flow description, field map, supported ATS)
   - If a new file was added or removed → update **Section 2 (Important Folders and Files)** and **Section 14 (Directory Structure)**
   - If a new ATS was added → update **Section 11 (Supported ATS Platforms)**
   - If a gap was closed → move it from **Section 13 (Limitations)** to the relevant capability section
   - If a new limitation was introduced → add it to **Section 13**
2. Commit the updated file: `git add CODEBASE-ANALYSIS.md && git commit -m "[Docs] Update CODEBASE-ANALYSIS after [feature-branch]"`

This keeps `CODEBASE-ANALYSIS.md` accurate and usable as a live reference — not a one-time snapshot. Always use `CODEBASE-ANALYSIS.md` as the source of truth in case anything is unclear.

## Bot-Only Scope

- **In scope:** lib/*.mjs (discovery, scanner, planner, fields, engine, workday, otp, learner, reporter), cli.mjs, config/*.yml patterns
- **Out of scope:** UI, backend API, database, Telegram integration, deployment infrastructure (if any)

## Workday-Specific Rules

- **Authentication before scanning:** scanForm must authenticate on Workday *before* extracting form fields (not after)
- **Post-signup redirect handling:** After workdayCreateAccount succeeds, Workday redirects. Do not retry workdayLogin; instead, detect redirect destination and continue
- **Multi-step wizard loop:** Workday forms have 3-5 wizard pages. Click "Next", rescan fields, refill, repeat until "Submit" or success page appears
- **No hardcoded selectors:** Always use `[data-automation-id="..."]` patterns first; fallback to `:has-text()` as secondary
- **Force clicks for modals:** Use `{ force: true }` or `.evaluate(el => el.click())` when Workday backdrop overlays intercept Playwright clicks
- **Honeypot filtering:** Skip fields with `data-automation-id="beecatcher"`, `name="website"`, `type="hidden"`
- **Session persistence:** Consider saving browserContext.storageState() after successful auth to avoid re-authenticating on every run (optional optimization)

## Checkpoint Pattern

Every slice includes a **Given/When/Then** checkpoint:

```
Given [precondition: e.g., "live Workday job URL + valid profile"],
When [action: e.g., "bot runs node cli.mjs apply <url>"],
Then [result: e.g., "form fields detected > 0 AND application.status = SUBMITTED"].
```

Checkpoint must pass on a real Workday URL before commit. No mocks, no assumptions.

## Code Style

- **Language:** JavaScript (Node.js, .mjs modules)
- **Async/await** over callbacks; no bare `setTimeout` polling (use Playwright's `waitFor*` methods)
- **Named exports** over default exports
- **JSDoc comments** on all public functions (purpose, params, return)
- **Environment variables:** Secrets via `.env` (never hardcoded)
- **Module separation:** Discovery separate from filling; scanning separate from planning

## Git & Branching

- **Branch format:** `fix/workday-{issue}` or `feat/workday-{feature}` (e.g., `fix/workday-post-signup-redirect`)
- **Commit format:** `[Workday] Short description` or `[Scan/Fill/Auth] Short description`
- **After merge:** Delete branch, update STATE.md immediately
- **No merge** until checkpoint passes on real Workday URL

## Blockers & Mitigation

| Blocker | Mitigation |
|---|---|
| Workday DOM changes / selector fails | Log failing selector + page URL; add fallback selectors; update planner.mjs FIELD_MAP |
| Multi-step wizard unclear | Record video of manual flow; have Claude/agy extract step map from video |
| OTP verification fails | Check Gmail IMAP credentials in .env; inspect recent Workday emails manually |
| Bot loops or hangs | Add timeout gates; log page URLs at each step; inspect screenshots/ folder for visual context |

---

**Established:** Workday bot, agy-only, STATE.md auto-updated per commit, live Workday testing required for all checkpoints.