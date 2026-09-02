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
| `planner.mjs` | Map fields to profile + pick resume | ✅ Working (includes Workday FIELD_MAP patterns) |
| `fields.mjs` | Locate elements + multi-strategy dropdown engine | ✅ Working |
| `engine.mjs` | Fill form, verify, submit, handle OTP | ✅ Workday wizard buttons, force clicks, dynamic SPA waits |
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

## ⚠️ Broken/Incomplete Features (Workday Only)

### 1. Pre-Scan Authentication Desync
**Problem:** `scanForm(url)` runs in fresh unauthenticated browser → scans only job description or login page → extracts 0 form fields.

**Location:** cli.mjs line 252 calls `scanForm(url)` before Workday login flow.

**Impact:** Generated plan contains no fills. fillForm runs but has nothing to fill.

**Fix:** Authenticate *before* scanning. New flow: detect Workday → authenticate → then scanForm.

---

### 2. Post-Signup Redirect Loop
**Problem:** workdayCreateAccount() succeeds, Workday auto-redirects to job description or first apply step. Code immediately calls workdayLogin(), which expects login form inputs. Form inputs are gone → workdayLogin fails → error logged.

**Location:** workday.mjs lines 167-173 (post-signup login attempt).

**Impact:** After successful account creation, flow halts. Bot attempts to restart from JD page (infinite loop visible in logs).

**Fix:** Detect redirect destination after signup. If already on form/wizard, skip login retry and continue with form filling.

---

### 3. Multi-Step Wizard Stubbed
**Problem:** engine.mjs lines 491-504 click "Next" once and stop. Workday forms have 3-5 wizard pages (Experience → Education → Disclosures → Review → Submit).

**Location:** engine.mjs lines 491-504.

**Impact:** Bot fills first page only, clicks Next once, halts. Remaining pages never filled. Application submitted incomplete or fails.

**Fix:** Loop: detect "Next" button → click → wait/rescan → refill → repeat until "Submit" or success page detected.

---

### 4. Tab Switching Fragile
**Problem:** Create Account ↔ Sign In tabs use inconsistent selectors. No fallback for modern Workday tab containers ([role="tab"]).

**Location:** workday.mjs lines 76-84.

**Impact:** Tab switches fail; stuck on wrong tab.

**Fix:** Add modern tab selectors. Support both old (button:has-text) and new ([role="tab"]) patterns.

---

### 5. Missing Workday DOM Selectors
- Searchable typeahead: `div[data-automation-id="select-widget"]`, `input[data-automation-id="searchBox"]`
- Multi-step tabs: `[data-automation-id="wizardStep"]`
- Add item buttons (work history/education): `button[data-automation-id="Add"]`, `button[data-automation-id="add-item"]`
- Voluntary self-identification fields

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

## 🔨 Execution Phases (Next Priorities)

### Phase 1: Fix Pre-Scan Auth
**Goal:** Authenticate on Workday before scanning form fields.

**Steps:**
1. Modify cli.mjs: detect Workday → call handleWorkday → then scanForm
2. Or: Pass credentials to scanForm; authenticate inside scanner.mjs before DOM extraction
3. Test: `node cli.mjs scan <workday-url>` should detect form fields (>0)

**Checkpoint:** `Given live Workday URL + valid email/password, When running scan, Then fields detected > 0 AND includes name, email, phone fields.`

---

### Phase 2: Fix Post-Signup Redirect
**Goal:** Handle Workday redirect after account creation; continue without retry-login.

**Steps:**
1. In workday.mjs: After workdayCreateAccount(), detect page URL/DOM
2. If already on form/wizard, skip workdayLogin retry
3. If still on login, proceed with login
4. Test on real Workday: Create account → verify OTP → confirm form appears (not redirect back to JD)

**Checkpoint:** `Given new Workday email, When account created + OTP verified, Then form fields visible (not JD page or error).`

---

### Phase 3: Implement Multi-Step Wizard Loop
**Goal:** Handle 3-5 wizard pages sequentially.

**Steps:**
1. Modify engine.mjs: Replace single Next click with loop
2. Loop: detect "Next" → click → waitForLoadState → rescan fields → refill → repeat
3. Exit loop when "Submit" button detected or success page appears
4. Test: Fill Experience, click Next → fill Education, click Next → repeat → submit

**Checkpoint:** `Given Workday form with 3+ wizard pages, When filling + submitting, Then all pages filled AND final submit succeeds.`

---

### Phase 4: Expand Workday Selectors
**Goal:** Add missing selectors for typeahead, tabs, add buttons.

**Steps:**
1. Update planner.mjs FIELD_MAP with Workday-specific ID patterns
2. Update fields.mjs to detect searchable typeahead (select-widget, searchBox)
3. Update engine.mjs clickSubmitButton with Workday wizard buttons
4. Test: Fill searchable dropdowns, add work history items, complete form

**Checkpoint:** `Given Workday form with typeahead + multi-item sections, When filling, Then all fields populated correctly.`

---

## 🎥 Next Step: Video Recording

To clarify multi-step wizard flow (unclear from code inspection alone):

1. **Record:** Manually complete a Workday application end-to-end
2. **Capture:** Each wizard page, field types, button positions, error states
3. **Feed to Claude:** Ask for step-by-step flow map (selectors, waits, validation logic)
4. **Implement:** Use flow map to build engine loop

---

## 📝 Recent Commits

| Commit | Date | Summary |
|---|---|---|
| a6cf707 | 2026-09-02 | [Workday] Fix application flow, auth pre-scan, and form discovery |
| be05095 | 2026-04-15 | feat: add list command — application dashboard |
| a680086 | 2026-04-15 | feat: add list command — application dashboard |
| 53fc2db | 2026-04-15 | publish: job-auto-apply@1.0.0 on npm |
| 6e9542e | 2026-04-15 | Add GitHub Actions workflow for npm package publishing |
| a2e359c | 2026-04-15 | feat: add npx support and enhanced setup wizard |

**Summary:** Resolved initial Apply button navigation, cookie dismissal, Sign In/Create Account tab handling, force-click overlays, honeypot filtering, pre-scan authentication, and Workday FIELD_MAP mappings.

---

## ✅ Ready to Start

- ✅ Live Workday sandbox account available
- ✅ agy workflow + STATE.md auto-update rule established
- ✅ Workday pre-scan auth, post-signup redirect, and form discovery implemented
- ⏳ Multi-step wizard loop across all pages (Phase 3) next priority