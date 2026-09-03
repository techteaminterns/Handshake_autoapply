# Workflow — Application Bot Flows

> **Source of truth:** All sign-in, sign-up, and application flows documented here are derived directly from the existing `auto-apply` codebase. Planned flows are clearly marked.

---

## 1. Complete Application Flow (V0 — Existing)

```mermaid
flowchart TD
    A([Terminal: node cli.mjs apply URL]) --> B[Load .env + profile.yml + resumes.yml]
    B --> C[Resolve credentials]
    C --> D[detectATS: url]
    D --> E[Launch Chromium browser]
    E --> F[discoverApplicationForm]
    F --> G{ATS?}
    G -->|Workday| H[handleWorkday: signin or signup]
    G -->|Other ATS| I[Navigate to form]
    H --> J{Auth OK?}
    J -->|No| K([Exit: auth-failed])
    J -->|Yes| L[extractJDText]
    I --> L
    L --> M[pickResume: keyword match]
    M --> N[generatePlan: scan + profile → fills]
    N --> O[applyLearnings: apply past corrections]
    O --> P{ATS?}
    P -->|Workday| Q[runWorkdayWizardLoop]
    P -->|Other| R[fillForm generic loop]
    Q --> S{OTP needed?}
    R --> S
    S -->|Yes| T[handlePostSubmitOTP: prompt terminal for OTP code]
    S -->|No| U[takeScreenshot]
    T --> U
    U --> V[logToCSV + recordResult]
    V --> W([Browser open 15s → close])
```

---

## 2. Sign-In Flow (Workday — Corrected)

> Triggered when `--signup` is not passed (default mode). Gateway appears after clicking Apply Manually.

```mermaid
flowchart TD
    A([node cli.mjs apply URL: default signin mode]) --> B[discoverApplicationForm]
    B --> C[Click Apply on JD page]
    C --> D[Click Apply Manually on popup]
    D --> E[Gateway page: click Sign In link]
    E --> F[Wait for email + password inputs]
    F --> G[workdayLogin: page, email, password]
    G --> H[Fill email input]
    H --> I[Fill password input]
    I --> J[Click signInSubmitButton force:true]
    J --> K[Wait 4s + networkidle]
    K --> L{Password input still visible?}
    L -->|Yes: login failed| M([Return: false])
    L -->|No: success| N([Return: true → proceed to application wizard])
```

---

## 3. Sign-Up Flow (Workday — Corrected)

> Triggered when `--signup` flag is passed.

```mermaid
flowchart TD
    A([node cli.mjs apply URL: --signup mode]) --> B[discoverApplicationForm]
    B --> C[Click Apply → Apply Manually]
    C --> D[Gateway page: click Create Account button]
    D --> E[Wait for verifyPassword input]
    E --> F[workdayCreateAccount]
    F --> G[Fill email input]
    G --> H{Password provided?}
    H -->|Yes| I[Use provided password]
    H -->|No| J[generatePassword: 12 chars + special + digit]
    I --> K[Fill password + verifyPassword inputs]
    J --> K
    K --> L[Check terms checkbox if present]
    L --> M[Click createAccountSubmitButton]
    M --> N[Wait 5s + networkidle]
    N --> O{Email verification prompt present?}
    O -->|Yes| P[Prompt user in terminal to enter OTP]
    P --> Q[Fill verification code + click Verify]
    O -->|No: direct proceed| R[isWorkdaySignInPage]
    Q --> R
    R --> S{Redirected to Sign In?}
    S -->|Yes| T[workdayLogin with new credentials]
    S -->|No: already on application form| U([Return: true])
    T --> V{Login success?}
    V -->|Yes| U
    V -->|No| W([Return: false])
```

---

## 4. ATS Discovery Flow (All ATS — Existing)

> Based on `lib/discovery.mjs` `discoverApplicationForm()`

```mermaid
flowchart TD
    A([discoverApplicationForm: page, url]) --> B{ATS detected?}
    B -->|Greenhouse| C[Click Apply for this job or Apply]
    C --> D[Scroll to #app section]
    D --> Z([Return form URL])
    B -->|Lever| E{Already on /apply path?}
    E -->|Yes| Z
    E -->|No| F[Click Apply link → navigate to /apply URL]
    F --> Z
    B -->|Ashby| G{Already on /application?}
    G -->|Yes| Z
    G -->|No| H[Click Apply button]
    H --> Z
    B -->|Workday| I[Accept cookie banner if present]
    I --> J{Already on wizard?}
    J -->|Yes| Z
    J -->|No| K[Click Apply button on JD page]
    K --> L{Apply Manually popup?}
    L -->|Yes| M[Click Apply Manually]
    L -->|No| N[Continue]
    M --> O{mode?}
    N --> O
    O -->|signin| P[Click Sign In link on gateway]
    O -->|signup| Q[Click Create Account link on gateway]
    P --> R[Wait for password input]
    Q --> S[Wait for verifyPassword input]
    R --> Z
    S --> Z
    B -->|Gem| T[Click Apply button]
    T --> Z
    B -->|Generic| U[Click any Apply for this job / Apply Now]
    U --> Z
```

---

## 5. Form Scan Flow (Existing)

> Based on `lib/scanner.mjs` `scanForm()`

```mermaid
flowchart TD
    A([scanForm: url]) --> B[Navigate to URL]
    B --> C[discoverApplicationForm]
    C --> D{ATS = Workday?}
    D -->|Yes| E[handleWorkday: authenticate]
    D -->|No| F[Already on form]
    E --> F
    F --> G[DOM pass 1: querySelectorAll input + textarea + select]
    G --> H[Extract label via: for-id, aria-label, aria-labelledby, placeholder, sibling text, data-automation-id]
    H --> I[DOM pass 2: custom dropdowns with role=listbox or combobox]
    I --> J[DOM pass 3: yes-no-button questions]
    J --> K[Detect submit buttons]
    K --> L[Write {slug}-scan.json]
    L --> M([Return scan object])
```

---

## 6. Plan Generation Flow (Existing)

> Based on `lib/planner.mjs` `generatePlan()`

```mermaid
flowchart TD
    A([generatePlan: scan, profile]) --> B[For each scanned field]
    B --> C{Field type?}
    C -->|file| D{Is resume field?}
    D -->|Yes + resumePath exists| E[Add to fills with resumePath]
    D -->|No| F[Skip]
    C -->|yes-no-button| G[Match label against FIELD_MAP]
    G --> H{Match found?}
    H -->|Yes| I[Add to fills with profile value]
    H -->|No| J[Add to unmapped]
    C -->|checkbox| K{Consent/agree/terms label?}
    K -->|Yes| L[Add to fills with true]
    K -->|No| M[Skip]
    C -->|Other types| N[Match label regex against FIELD_MAP 83 entries]
    N --> O{Match found?}
    O -->|Yes, _static.*| P[Use literal static value]
    O -->|Yes, profile path| Q[getNestedValue from profile.yml]
    Q --> R{Value exists?}
    R -->|Yes| S[Add to fills]
    R -->|No| T[Add to unmapped]
    O -->|No match| T
    P --> S
    S --> U{Type = select with options?}
    U -->|Yes| V[Fuzzy match value against option texts]
    V --> W{Score ≥ 0.3?}
    W -->|Yes| X[Use matched option text]
    W -->|No| Y[Keep original value]
    U -->|No| Y
    X --> Z
    Y --> Z
    Z([Continue to next field])
    Z --> AA([Return plan: fills + skipped + unmapped])
```

---

## 7. Workday Wizard Fill Loop (Existing)

> Based on `lib/engine.mjs` `runWorkdayWizardLoop()`

```mermaid
flowchart TD
    A([runWorkdayWizardLoop: page, profile, plan]) --> B[Iteration 1..10]
    B --> C[detectWorkdayStep]
    C --> D{Step detected?}
    D -->|My Information| E[Fill personal info: name, email, phone, address, source]
    D -->|My Experience| F[Expand Work Experience section]
    F --> G[Upload resume PDF]
    G --> H[Check currently work here checkbox]
    H --> I[Fill experience fields]
    D -->|Application Questions| J[Fill custom questions]
    D -->|Voluntary Disclosures| K[Check terms checkbox]
    K --> L[Fill EEO fields]
    D -->|Review| M[Take screenshot]
    M --> N[Click Submit button]
    E --> O[Scan visible inputs: querySelectorAll]
    I --> O
    J --> O
    L --> O
    O --> P[For each visible field: mapLabelToProfileValue]
    P --> Q{Value found?}
    Q -->|Yes| R[Fill field by type]
    Q -->|No| S[Skip field]
    R --> T[advanceWorkdayStep: click Save and Continue]
    S --> T
    T --> U{Validation errors?}
    U -->|Yes| V[Re-fill step]
    V --> W[Re-advance]
    U -->|No| X{Same step 3x?}
    X -->|Yes| Y([Break: stuck])
    X -->|No| B
    N --> Z{Confirmation text found?}
    Z -->|Yes| AA([Return: submitted])
    Z -->|No: OTP prompt| AB[handlePostSubmitOTP]
    AB --> AA
```

---

## 8. OTP Handling Flow (Corrected — Terminal Prompt in V0/V1)

> Based on `lib/otp.mjs` (pre-dashboard flow)

```mermaid
flowchart TD
    A([handlePostSubmitOTP: page]) --> B[Detect OTP/verification prompt on page]
    B --> C{OTP prompt found?}
    C -->|No| D([Return: submitted])
    C -->|Yes| E[Prompt user in terminal: Enter OTP code]
    E --> F[User types code via stdin/readline]
    F --> G[Find OTP input selector on page]
    G --> H{Input found?}
    H -->|No| I[Fallback: find empty visible text input]
    H -->|Yes| J[enterOTP: type character-by-character]
    I --> J
    J --> K[Click Verify / Confirm / Submit]
    K --> L([Return: submitted-with-otp])
```

---

## 9. Telegram Confirmation Flow (V1 — Planned)

```mermaid
flowchart TD
    A([Job picked up from queue]) --> B[Extract job info: title, company, URL]
    B --> C[sendTelegramConfirmation: user chat_id]
    C --> D[Message: Job Title + Company + URL + Yes/No buttons]
    D --> E{User responds?}
    E -->|Yes button| F[Mark job: confirmed]
    E -->|No button| G[Mark job: skipped]
    E -->|No response - timeout| H[Mark job: pending, do not apply]
    F --> I[Start application pipeline]
    G --> J([Move to next job])
    H --> J
    I --> K{Application result?}
    K -->|submitted| L[Mark job: submitted]
    K -->|failed| M[Mark job: failed]
    L --> J
    M --> J
```

---

## 10. Telegram Q&A Fallback & Answer Persistence Flow (V1+ — Planned)

```mermaid
flowchart TD
    A([Field encountered during planning/filling]) --> B{Answer in profile?}
    B -->|Yes| C[Fill field using profile value]
    B -->|No| D{Answer in parsed resume?}
    D -->|Yes| E[Fill field using resume value]
    E --> F[Store answer in profile.yml / Supabase for future use]
    D -->|No| G[Send question to user via Telegram]
    G --> H{User replies?}
    H -->|Yes: user provides answer| I[Fill field with provided answer]
    I --> J[Save answer to profile.yml / Supabase for future use]
    H -->|No: timeout| K[Skip unmapped field]
```

---

## 11. Multi-User Parallel Workers & Sequential Job Queue Flow (V2 — Planned)

```mermaid
flowchart TD
    subgraph Parallel Worker Pool
        W1[Worker 1 - User A]
        W2[Worker 2 - User B]
        W3[Worker 3 - User C]
    end

    W1 --> Q1[Process Queue A: Job 1 → Job 2 → Job N]
    W2 --> Q2[Process Queue B: Job 1 → Job 2 → Job N]
    W3 --> Q3[Process Queue C: Job 1 → Job 2 → Job N]

    Q1 --> B1[Isolated Chromium Browser A]
    Q2 --> B2[Isolated Chromium Browser B]
    Q3 --> B3[Isolated Chromium Browser C]

    B1 --> S1[Sequential Application Execution]
    B2 --> S2[Sequential Application Execution]
    B3 --> S3[Sequential Application Execution]
```

---

## 12. System-Level Data Flow (V2 — Planned)

```mermaid
flowchart LR
    U([User]) -->|Adds profile via form| D[Dashboard]
    U -->|Adds job links| D
    D -->|Writes| SB[(Supabase)]
    SB -->|Realtime push| D
    SB -->|Reads jobs + profiles| BW[Parallel Worker Pool]
    BW -->|Sends confirmation & Q&A| TG[Telegram]
    TG -->|User taps Yes/No or replies| BW
    BW -->|Spawns isolated browsers| PW[Playwright Workers]
    PW -->|Fills application| ATS[Job Application Form]
    BW -->|Writes results & new answers| SB
```
