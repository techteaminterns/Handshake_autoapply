# STATE.md — Workday Auto-Apply Bot

**Project:** Workday job application automation (CLI bot only)  
**Status:** Active Development — Workday Discovery, Auth, and Pre-Scan Flow Implemented  
**Last Updated:** 2026-09-02  
**Test Environment:** Live Workday sandbox account available

---

## Project Overview

Node.js/Playwright bot that:
1. Detects ATS platform (Workday, Greenhouse, Lever, Ashby, etc.)
2. Scans form fields and generates apply plan
3. Fills forms with profile data + resumes (with multi-strategy dropdown engine)
4. Submits and handles OTP verification via Gmail IMAP
5. Logs applications to CSV + takes pre/post screenshots

**Scope:** Bot automation only (lib/*.mjs, cli.mjs). No UI, API, or database.  
**Tech Stack:** Node.js, Playwright, YAML config, Gmail IMAP  
**Entry:** `node cli.mjs apply <url>`

---

## Current Architecture (lib/*.mjs)

| Module | Purpose | Status |
|---|---|---|
| `discovery.mjs` | ATS detection + initial navigation to form | ✅ Working (Greenhouse, Lever, Ashby, Workday JD navigation) |
| `scanner.mjs` | Extract form fields → forms/{slug}-scan.json | ✅ Pre-scan auth on Workday, honeypot filtering, label parsing |
| `planner.mjs` | Map fields to profile + pick resume | ✅ Working (Workday 5-step FIELD_MAP patterns, mapLabelToProfileValue) |
| `fields.mjs` | Locate elements + multi-strategy dropdown engine | ✅ Working (Workday select-widget, promptOption, automationId) |
| `engine.mjs` | Fill form, verify, submit, handle OTP | ✅ Workday 5-step wizard loop, async file upload gate, section expander |
| `workday.mjs` | Workday auth (login/signup) | ✅ Tab switching, force clicks, post-signup redirect handling |
| `otp.mjs` | Gmail IMAP OTP extraction | ✅ Working |
| `learner.mjs` | Store field corrections → learnings.json | ✅ Working |
| `reporter.mjs` | Screenshots, CSV logging, queue mgmt | ✅ Working |

---

## ✅ Working Features

- **Greenhouse, Lever, Ashby:** Full end-to-end apply flow (scan → plan → fill → submit)
- **Dropdown Engine:** 4-tier strategy (native select, React Select type-to-filter, click-scan, keyboard nav)
- **Form Verification & Retry:** Re-inspects DOM post-fill, retries empty fields (3 passes)
- **Gmail OTP:** Robust IMAP polling + regex extraction for verification codes
- **Config & Profiles:** Dynamic YAML parsing (profile.yml, resumes.yml)
- **Queue & Reporting:** `queue add/list`, `status` dashboard, applied.csv logging
- **Screenshot Capture:** Pre/post-submit audit trail

---

## ✅ Workday Pipeline Status (Resolved)

- **Pre-Scan Auth & Credential Resolution**: Sourced from `profile.yml`, `.env`, and CLI flags across `cli.mjs`, `scanner.mjs`, and `engine.mjs`.
- **Post-Signup Redirect & Page Detection**: `isWorkdaySignInPage` checks whether sign-in form inputs or wizard fields are active; bypasses redundant login and discovery.
- **5-Step Wizard Loop**: Fully implemented in `engine.mjs` (`detectWorkdayStep`, `fillCurrentWorkdayStep`, `advanceWorkdayStep`, `runWorkdayWizardLoop`).
- **Subsection Expanders & Async Gates**: Automatically expands Work Experience, Education, and Website subsections; enforces upload completion before "Save and Continue".
- **Error Handling & Diagnostic Logging**: `fillForm` and `cmdApply` wrapped in try-catch with URL, timestamp, 10s visual pause, and clean browser shutdown without restarting/reopening links.

---

## 📊 Config & Test State

| Item | State | Notes |
|---|---|---|
| `profile.yml` | Template (Jane Doe, Google, Stanford) | Needs real user data |
| `resumes/` | Empty (only .gitkeep) | No PDF files present |
| `data/applied.csv` | Uninitialized | No historical logs yet |
| `data/queue.csv` | Uninitialized | No pending queue entries |
| `data/learnings.json` | Uninitialized | Created on first run |
| **Live Workday URL** | ✅ Available | Real sandbox account ready for testing |

---

## 🔨 Execution Phases

### Phase 1: Fix Pre-Scan Auth ✅
**Goal:** Authenticate on Workday before scanning form fields.
**Status:** Completed. `cli.mjs` resolves credentials from `profile.yml`, `.env`, and CLI flags, and `scanner.mjs` invokes `handleWorkday` before extracting form fields.

---

### Phase 2: Fix Post-Signup Redirect ✅
**Goal:** Handle Workday redirect after account creation; continue without retry-login.
**Status:** Completed. Post-signup destination detection in `workday.mjs` checks `isWorkdayLogin` before any login retry.

---

### Phase 3: Implement Multi-Step Wizard Loop ✅
**Goal:** Handle 3-5 wizard pages sequentially.
**Status:** Completed. `runWorkdayWizardLoop` in `engine.mjs` detects step name (`My Information`, `My Experience`, `Application Questions`, `Voluntary Disclosures`, `Review`), handles subsection "Add" expansions, enforces async resume upload completion gates, advances with "Save and Continue" + networkidle + 2.5s hydration waits, and submits at Review.

---

### Phase 4: Expand Workday Selectors ✅
**Goal:** Add missing selectors for typeahead, tabs, add buttons.
**Status:** Completed. Added `select-widget`, `promptOption`, `menuItem`, `data-automation-id` finder strategies in `fields.mjs`, and expanded `FIELD_MAP` in `planner.mjs`.

---

## 📝 Recent Commits

| Commit | Date | Summary |
|---|---|---|
| current | 2026-09-02 | [Workday] Implement 5-step wizard loop, async upload gate, and selector expansion |
| a6cf707 | 2026-09-02 | [Workday] Fix application flow, auth pre-scan, and form discovery |
| be05095 | 2026-04-15 | feat: add list command — application dashboard |
| a680086 | 2026-04-15 | feat: add list command — application dashboard |
| 53fc2db | 2026-04-15 | publish: job-auto-apply@1.0.0 on npm |

---

## ✅ Current Status

- ✅ Workday 5-step wizard loop active in `engine.mjs`
- ✅ Dynamic section expansion ("Add" / "Add Another") for Work Experience, Education, Website
- ✅ Asynchronous resume upload verification (`[data-automation-id="file-upload-item"]` / checkmark)
- ✅ Searchable dropdown, typeahead, and custom select support
- ✅ Review step validation and submission flow with post-submit OTP handling