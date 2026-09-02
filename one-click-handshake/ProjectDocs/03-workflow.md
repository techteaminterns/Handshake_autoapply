# Workflow — OneClickHandshake V1

## App Flow (high-level)
1. User opens app → auth (sign up / sign in to our platform)
2. User completes onboarding → all fields + resume + Telegram link stored to Supabase
3. User reaches monitoring UI → bot status visible
4. Bot signs into Handshake (sign-up flow for new users, sign-in for existing)
5. Bot scrapes jobs daily → sends Telegram prompt with inline Yes/No buttons per job
6. User taps Yes/No button in Telegram
7. Bot picks approved jobs from queue → applies sequentially
8. Interventions (OTP, confirmation, unknown questions) surface as popups in monitoring UI
9. User resolves popup → bot continues
10. Monitoring UI updates live throughout

## User Flow per Core Feature

**Onboarding**
1. User fills: name, email, phone, school, major, degree, grad month/year, school info, resume (PDF <1MB), job types, locations, job interests, profile visibility, job alerts toggle
2. User taps "Link Telegram" deep link → chat starts → webhook captures chat_id
3. User answers "Do you have a Handshake account?" Yes/No
4. Submit → all fields written to Supabase profiles + resumes tables
5. User lands on monitoring UI

**Handshake sign-up (has_existing_handshake_account = false)**
1. Bot opens Handshake signup, fills fields from stored profile
2. Bot sets a custom password (stored encrypted in DB)
3. Handshake sends confirmation email → bot creates AUTH_EMAIL_CONFIRM intervention → popup appears in monitoring UI
4. User confirms email in their inbox → taps "Done" in popup
5. Bot detects confirmation → continues
6. Handshake prompts phone verification → bot enters phone number → sends OTP → creates OTP intervention → popup appears
7. User enters OTP in popup → bot fills field → continues
8. Bot completes remaining Handshake onboarding screens using stored profile data
9. Bot reaches Handshake home → sign-up complete

**Handshake sign-in (has_existing_handshake_account = true)**
1. Bot opens Handshake login, enters email
2. Handshake sends OTP to student email → bot creates OTP intervention → popup appears in monitoring UI
3. User enters OTP in popup → bot fills field → logs in
4. Session stored in browser profile

**Session health check (every 30 mins)**
1. Worker triggers `checkSessionHealth`
2. If logged in → no action
3. If not logged in → create AUTH intervention → popup in monitoring UI → user resolves → bot re-runs sign-in

**Daily job scrape**
1. Worker triggers `runScrape` with profile preferences (job types, locations, interests)
2. Bot scrapes Handshake jobs page filtered by preferences
3. New jobs stored to `handshake_jobs` (deduplicated by URL)
4. For each new job: worker sends Telegram prompt "Apply to [title] at [company]? [url]" with inline Yes/No buttons
5. User taps Yes → application row created as APPROVED+QUEUED
6. User taps No → application row created as REJECTED (permanent)

**Apply flow**
1. Worker calls `claimNextJob` → atomically claims one APPROVED+QUEUED application
2. Bot opens job URL
3. Detects Quick Apply vs Apply → always prefers Quick Apply if both present
4. Document upload: always "Upload new" → attaches resume from Supabase Storage URL
5. For each form question:
   - Check profile data first → auto-fill if matched
   - If unknown → create UNKNOWN_QUESTION intervention → popup in monitoring UI → user answers → bot fills → answer stored for reuse
6. Review step → submit
7. Bot checks DOM for success confirmation
8. If confirmed → mark SUBMITTED
9. If uncertain → mark FAILED (never assume success)
10. `safeExit` → worker claims next job

**Intervention popup flow (monitoring UI)**
1. Supabase Realtime fires on new OPEN intervention row
2. Monitoring UI renders popup with: type label, question text, input field or confirm button
3. User submits answer → API writes answer to interventions row, sets status RESOLVED
4. Side B's `resolveIntervention` poll returns → bot continues

## System/Data Flow

- Onboarding submit → `/api/onboarding` → Supabase profiles + resumes upsert
- Telegram /start → `/api/telegram/webhook` → profiles.telegram_chat_id update
- Worker 30min tick → `checkSessionHealth()` (Side B) → if false → `createIntervention()` (Side A)
- Worker daily tick → `runScrape()` (Side B) → `storeJobsFromScrape()` (Side A) → Telegram send per new job
- Telegram callback query (Yes/No button tap) → `/api/telegram/webhook` → match to pending job → create/update application row (QUEUED/REJECTED)
- Worker apply loop → `claimNextJob()` → `runApplyToJob()` (Side B) → `createIntervention()` as needed → `markJobStatus()` on completion
- Monitoring UI → Supabase Realtime subscription on interventions + applications → live updates

## Edge Cases & Error States

- Resume missing or >1MB → block onboarding submission, inline error
- Handshake DOM changed → safeExit, mark FAILED, log selector context
- Quick Apply not present and Apply not present (external ATS) → mark FAILED with reason `no_apply_option`
- Job already applied → mark ALREADY_APPLIED, do not resubmit
- Intervention not resolved within session → worker pauses that job, moves to next if browser state clean
- Session health check fails repeatedly → create intervention, halt apply loop until resolved
- Telegram reply arrives with no matching pending job → ignore silently, log
- Scrape returns zero jobs → log, no intervention needed, retry next daily cycle
- Rate limit (300 actions/day) hit → halt worker, log halt reason
