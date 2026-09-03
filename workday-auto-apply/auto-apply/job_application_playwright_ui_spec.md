# Job Application Flow — UI Description for Playwright Automation

## Purpose

This document describes the job application UI shown in the provided screenshots.

It is intended to give an LLM enough visual and structural context to write reliable Playwright automation for the application flow.

**Important automation principle:** do not rely only on coordinates or screenshots. Prefer semantic locators such as:

- `getByLabel()`
- `getByRole()`
- `getByText()`
- `locator('input[name="..."]')` when stable attributes exist
- nearby section/container relationships when labels are duplicated

The exact DOM attributes are not visible in these screenshots, so the implementation should inspect the live DOM and choose the most stable selectors available.

---

# 1. Overall Application Structure

The application is a multi-step wizard for the job:

**AI Engineering Intern**

At the top of every step there is:

1. A **Back to Job Posting** link.
2. The job title.
3. A horizontal progress indicator.
4. Five application stages:

```text
My Information
      ↓
My Experience
      ↓
Application Questions
      ↓
Voluntary Disclosures
      ↓
Review
```

## Progress Bar Behavior

The progress bar visually indicates the current step.

Completed steps use a dark teal circle/checkmark and a teal connecting line.

Future steps appear gray.

The current step is highlighted differently depending on the state.

### Step order

| Step | Page heading |
|---|---|
| 1 | My Information |
| 2 | My Experience |
| 3 | Application Questions |
| 4 | Voluntary Disclosures |
| 5 | Review |

## Navigation

Most pages have a fixed/sticky footer area containing:

- **Back**
- **Save and Continue**

The first page shown does not visibly require a Back button.

The final Review page has:

- **Back**
- **Submit**

Automation should wait for navigation/state changes after clicking **Save and Continue** rather than assuming an immediate URL change.

---

# 2. Step 1 — My Information

![My Information](01-my-information.png)

## Page heading

```text
My Information
```

A note indicates:

```text
* Indicates a required field
```

## Section: General Information

### Field: How Did You Hear About Us? *

- Required.
- Appears to be a searchable/select-style input.
- Screenshot value: `LinkedIn`.
- There is an icon on the right side of the field.

### Field: Country *

- Required dropdown/select.
- Screenshot value: `India`.

---

## Section: Name

### Field: Given Name(s) *

- Required text input.
- Screenshot contains a prefilled value.

### Field: Family Name

- Optional text input.
- Screenshot contains a prefilled value.

### Field: Local Given Name(s)

- Optional text input.
- Empty in the screenshot.

### Field: Local Family Name

- Optional text input.
- Empty in the screenshot.

---

## Section: Address

### Field: Address Line 1 *

- Required text input.
- Screenshot contains a prefilled address.

### Field: City

- Text input.
- Screenshot value: `Hyderabad`.

### Field: Postal Code

- Text input.
- Screenshot contains a numeric postal code.

---

## Section: Email Address

The page displays an existing email address.

This appears to be read-only/display text rather than an editable input.

Automation should inspect the DOM before attempting to fill it.

---

## Section: Phone

### Field: Phone Device Type *

- Required dropdown.
- Screenshot value: `Mobile`.

### Field: Country Phone Code *

- Required country-code selector.
- Screenshot value appears to be `India (+91)`.

### Field: Phone Number *

- Required text input.
- Screenshot contains a prefilled phone number.

### Field: Phone Extension

- Optional text input.
- Empty in the screenshot.

---

## Primary action

```text
Save and Continue
```

### Expected automation behavior

1. Detect that the current page is **My Information**.
2. Fill missing required fields.
3. Do not overwrite existing values unless intentionally required.
4. Click **Save and Continue**.
5. Wait until the wizard advances to **My Experience**.

---

# 3. Step 2 — My Experience

![My Experience](02-my-experience.png)

## Page heading

```text
My Experience
```

A required-field indicator is shown.

The page contains several sections:

1. Work Experience
2. Education
3. Languages
4. Skills
5. Resume/CV
6. Website

---

## Section: Work Experience

A work-experience entry is displayed.

There is an **Edit** control associated with the entry.

### Visible fields when editing/adding experience

- Job Title *
- Company *
- Location
- A checkbox related to current employment
- From *
- To
- Role Description

### Date fields

The date controls appear to support month/year style values.

There may also be a checkbox indicating:

```text
I currently work here
```

Automation should inspect the exact label and control type in the live DOM.

### Role Description

A large multiline textarea is available.

### Action

```text
Add Another
```

Use this to add another work-experience entry if required.

---

## Section: Education

An education entry is displayed with an **Edit** control.

### Visible fields

- School/University *
- Degree *
- Field of Study
- Grade/score field
- Start date
- End date

The exact required status of some fields should be determined from the live DOM.

### Action

```text
Add Another
```

Use this to add another education entry.

---

## Section: Languages

A language area is shown.

### Action

```text
Add
```

Automation should:

1. Click **Add** when a language needs to be added.
2. Identify the language-selection controls that appear.
3. Fill/select the desired language.
4. Save the entry if a save action is presented.

---

## Section: Skills

A multi-value skills control is visible.

The screenshot shows multiple existing skill entries/tags.

Automation should treat this as potentially:

- a multi-select,
- autocomplete,
- tag input,
- or searchable combobox.

Do not assume it is a plain text input.

Inspect the DOM and use keyboard selection if necessary.

---

## Section: Resume/CV

A resume upload area is present.

The UI includes:

- a dashed drag-and-drop upload region,
- a **Drop file here** style instruction,
- an option to browse/select a file,
- an existing uploaded resume/document,
- a delete/trash icon.

### Playwright recommendation

Do not automate the operating-system file picker.

Use Playwright's file upload mechanism directly against the file input:

```text
setInputFiles(...)
```

The implementation should first locate the actual `<input type="file">`, even if it is visually hidden.

After upload:

1. Wait for the uploaded file to appear.
2. Verify the filename or uploaded-state indicator.
3. Continue only after upload completes.

---

## Section: Website

A website section is shown.

### Action

```text
Add
```

Use this to add a website/portfolio URL if required.

---

## Navigation

Footer buttons:

```text
Back
Save and Continue
```

### Expected automation behavior

After completing required information:

1. Click **Save and Continue**.
2. Wait for the page heading/state to become **Application Questions**.

---

# 4. Step 3 — Application Questions

![Application Questions](03-application-questions.png)

## Page heading

```text
Application Questions
```

A required-field note is shown.

The page begins with explanatory text about conflicts of interest.

The explanatory content includes examples such as:

- serving as a board member/director,
- outside business activities,
- financial interests in competitors/customers/suppliers,
- close family relationships relevant to the role.

---

## Question 1: Conflict of Interest *

The question asks the applicant to review the definition of a conflict of interest and indicate whether any conditions apply.

### Control type

Dropdown/select.

### Screenshot value

```text
No
```

---

## Question 2: Are you legally eligible to work in the country to which you are applying? *

### Control type

Dropdown/select.

### Screenshot value

```text
Yes
```

---

## Question 3: Are you a current contractor for our company? *

### Control type

Dropdown/select.

### Screenshot value

```text
No
```

---

## Question 4: Have you previously worked for our company? *

### Control type

Dropdown/select.

### Screenshot value

```text
No
```

---

## Navigation

Footer:

```text
Back
Save and Continue
```

### Expected automation behavior

For each question:

1. Locate the question by its visible label text.
2. Locate the associated select/dropdown.
3. Choose the required answer.
4. Avoid positional selectors such as "the first select" because question order could change.

Then:

1. Click **Save and Continue**.
2. Wait for **Voluntary Disclosures**.

---

# 5. Step 4 — Voluntary Disclosures

![Voluntary Disclosures](04-voluntary-disclosures.png)

## Page heading

```text
Voluntary Disclosures
```

A required-field note is shown.

---

## Section: Personal Information

### Field: Please select your gender *

- Required dropdown/select.
- Screenshot value: `Male`.

This is a voluntary disclosure field.

The automation should only fill this field when an explicit user-approved value is available.

Do not invent sensitive personal information.

---

## Section: Terms and Conditions

A privacy notice explains that candidate information will be used in connection with employment.

A privacy-policy/recruiting link is displayed.

### Required consent

```text
Yes, I have read and consent to the terms and conditions *
```

### Control type

Checkbox.

### Expected automation behavior

1. Locate the consent text.
2. Locate its associated checkbox.
3. Check it.
4. Verify that the checkbox is checked before continuing.

---

## Navigation

Footer:

```text
Back
Save and Continue
```

After saving, wait for the **Review** step.

---

# 6. Step 5 — Review

![Review](05-review.png)

## Page heading

```text
Review
```

This page displays a summary of all previously entered application data.

The progress indicator shows the workflow at the final step.

---

## Section: My Information

The review summary includes:

### Name

- Given Name(s)
- Family Name

### Address

- Address line
- City
- Postal code

### Email Address

- Email

### Phone

- Phone device/type
- Country phone code
- Phone number

---

## Section: My Experience

### Work Experience

Summary information includes:

- Job title
- Company
- Location
- Dates
- Role description

### Education

Summary information includes:

- School
- Education/degree
- Field of study
- Dates

### Languages

Displays added language information.

### Skills

Displays selected skills.

### Resume/CV

Displays the uploaded document.

### Website

Displays any added website information.

---

## Section: Application Questions

Displays the answers selected during the Application Questions step.

---

## Final navigation

Footer buttons:

```text
Back
Submit
```

### Expected automation behavior before submission

Before clicking **Submit**, verify:

1. Current page heading is `Review`.
2. Required major sections are present.
3. The expected application data is visible.
4. A resume is present if required.
5. Application questions contain expected answers.
6. Terms/consent requirements have been completed.

Only then click:

```text
Submit
```

After clicking Submit:

- wait for a success/confirmation state,
- capture the confirmation text or URL,
- do not immediately close the browser before confirming successful submission.

---

# 7. Recommended Playwright Page-State Detection

The automation should not assume that every run starts on Step 1.

The user may already be:

- partially through the application,
- returning to an existing application,
- on a different wizard step.

Use a state-detection function based on visible headings.

## Suggested state logic

```text
IF "My Information" heading is visible
    → handle My Information

ELSE IF "My Experience" heading is visible
    → handle My Experience

ELSE IF "Application Questions" heading is visible
    → handle Application Questions

ELSE IF "Voluntary Disclosures" heading is visible
    → handle Voluntary Disclosures

ELSE IF "Review" heading is visible
    → validate and submit

ELSE
    → capture diagnostics and throw an error
```

Do not rely exclusively on URL patterns.

A combination of:

- URL,
- page heading,
- progress indicator,
- unique form labels

is more robust.

---

# 8. Locator Strategy for the LLM Writing Playwright Code

## Prefer

```javascript
page.getByRole(...)
page.getByLabel(...)
page.getByText(...)
```

Examples of locator intent:

```text
Heading "My Information"
Label "Country"
Label "Given Name(s)"
Label "Are you legally eligible to work..."
Text "Save and Continue"
Text "Submit"
```

## Avoid

- absolute XPath,
- screen coordinates,
- hardcoded pixel positions,
- selectors based only on CSS classes that may be generated dynamically.

## For dropdowns

Determine whether the UI is:

- native `<select>`,
- custom combobox,
- searchable dropdown.

Use the appropriate interaction strategy after inspecting the DOM.

## For file uploads

Locate the real file input and use Playwright file APIs.

## For checkboxes

Prefer the label/checkbox association and verify the final checked state.

---

# 9. Recommended Automation Flow

```text
START
  │
  ▼
Detect current application step
  │
  ├── My Information
  │      │
  │      ▼
  │   Fill/validate fields
  │      │
  │      ▼
  │   Save and Continue
  │
  ├── My Experience
  │      │
  │      ▼
  │   Fill/validate experience, education, skills, resume
  │      │
  │      ▼
  │   Save and Continue
  │
  ├── Application Questions
  │      │
  │      ▼
  │   Answer required dropdown questions
  │      │
  │      ▼
  │   Save and Continue
  │
  ├── Voluntary Disclosures
  │      │
  │      ▼
  │   Fill only explicitly approved voluntary values
  │   Accept required terms
  │      │
  │      ▼
  │   Save and Continue
  │
  └── Review
         │
         ▼
      Validate summary
         │
         ▼
       Submit
         │
         ▼
  Wait for confirmation
         │
         ▼
        END
```

---

# 10. Important Reliability Requirements

The Playwright implementation should:

- Be resumable from any application step.
- Detect the current page before performing actions.
- Avoid overwriting already-correct information unnecessarily.
- Handle prefilled fields.
- Wait for UI state changes after navigation.
- Verify dropdown selections after choosing values.
- Verify checkbox state.
- Verify resume upload completion.
- Use semantic locators whenever possible.
- Capture screenshots and useful diagnostics on failure.
- Fail clearly if the current page cannot be identified.
- Confirm successful submission before reporting completion.

---

# 11. Suggested Prompt Context for the Code-Generating LLM

Use this document as the UI specification and instruct the coding LLM:

> Write Playwright automation for this multi-step job application wizard. First inspect the existing project structure and existing automation patterns. Implement robust page-state detection so the automation can resume from any step. Use semantic Playwright locators and inspect the live DOM for stable selectors instead of using screenshot coordinates. Handle custom dropdowns, prefilled fields, file uploads, checkboxes, navigation waits, and final submission confirmation. Do not invent personal or sensitive values; use only values provided by the calling application/user configuration.

---

# Screenshot Index

1. [My Information](01-my-information.png)
2. [My Experience](02-my-experience.png)
3. [Application Questions](03-application-questions.png)
4. [Voluntary Disclosures](04-voluntary-disclosures.png)
5. [Review](05-review.png)
