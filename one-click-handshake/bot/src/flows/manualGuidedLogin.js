const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const { createObjectCsvWriter } = require('csv-writer');
const defaultProfile = require('../fixtures/profile');
const { promptOtp } = require('../promptOtp');

// ---------- Onboarding Autofill Function ----------
async function runOnboardingAutofill(page, profile, runId, userData) {
  console.log('🚀 Starting dynamic onboarding autofill routine...');
  
  // Page safety check
  const isPageValid = async () => {
    try {
      if (page.isClosed()) return false;
      await page.evaluate(() => document.body);
      return true;
    } catch (e) {
      console.log('⚠️ Page context invalid:', e.message);
      return false;
    }
  };
  
  // Helper: Normalize text for matching
  const normalizeText = (text) => {
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
  };
  
  // Helper: Find field by semantic label matching
  const findFieldByLabel = async (labelKeywords) => {
    if (!(await isPageValid())) return null;
    
    console.log(`[FIND] Searching for field with keywords: ${labelKeywords.join(', ')}`);
    
    // Get all visible labels and their text
    const labels = await page.evaluate(() => {
      const allLabels = Array.from(document.querySelectorAll('label, [role="label"], .label, .field-label, .form-label'));
      return allLabels.map(el => ({
        text: el.textContent?.trim() || '',
        element: el.outerHTML?.substring(0, 200) || ''
      })).filter(l => l.text.length > 0);
    }).catch(() => []);
    
    // Score each label based on keyword matches
    let bestMatch = null;
    let bestScore = 0;
    
    for (const label of labels) {
      const normalizedLabel = normalizeText(label.text);
      let score = 0;
      
      for (const keyword of labelKeywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (normalizedLabel.includes(normalizedKeyword)) {
          score += 1;
          // Bonus for exact match or close match
          if (normalizedLabel === normalizedKeyword) score += 2;
        }
      }
      
// Penalize partial/irrelevant matches
      for (const otherKeyword of labelKeywords) {
        if (normalizedLabel.includes(normalizeText(otherKeyword))) {
          score += 0.5;
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = label;
      }
    }
    
    if (bestMatch && bestScore >= 1) {
      console.log(`[FIND] Best match: "${bestMatch.text}" (score: ${bestScore})`);
      return bestMatch.text;
    }
    
    console.log(`[FIND] No match found for keywords: ${labelKeywords.join(', ')}`);
    return null;
  };
  
  // Helper: Determine control type and locate element
  const locateControl = async (labelText) => {
    if (!(await isPageValid())) return null;
    
    console.log(`[LOCATE] Finding control for label: "${labelText}"`);
    
    // Try multiple strategies to find the associated control
    const strategies = [
      // Strategy 1: Find by aria-labelledby
      async () => {
        const labels = await page.$$eval('label, [role="label"]', els => 
          els.map(el => ({ id: el.id, for: el.getAttribute('for'), text: el.textContent?.trim() }))
        );
        const matchingLabel = labels.find(l => normalizeText(l.text) === normalizeText(labelText));
        if (matchingLabel) {
          if (matchingLabel.for) {
            const control = page.locator(`#${matchingLabel.for}`).first();
            if (await control.isVisible({ timeout: 1000 }).catch(() => false)) {
              console.log(`[LOCATE] Found by 'for' attribute: #${matchingLabel.for}`);
              return { element: control, type: await determineControlType(control) };
            }
          }
        }
        return null;
      },
      
      // Strategy 2: Find by role and name
      async () => {
        const roles = ['combobox', 'textbox', 'listbox', 'select'];
        for (const role of roles) {
          try {
            const control = page.getByRole(role, { name: new RegExp(labelText, 'i') }).first();
            if (await control.isVisible({ timeout: 1000 }).catch(() => false)) {
              console.log(`[LOCATE] Found by role ${role} with name matching label`);
              return { element: control, type: await determineControlType(control) };
            }
          } catch (e) {}
        }
        return null;
      },
      
      // Strategy 3: Find by label text and traverse DOM
      async () => {
        const label = page.locator(`label:has-text("${labelText}")`).first();
        if (await label.count() > 0) {
          const container = label.locator('xpath=ancestor::*[self::div or self::fieldset or self::section][1]');
          const control = container.locator('input:not([hidden]):not([readonly]), select:not([hidden]):not([readonly]), textarea:not([hidden]):not([readonly]), button[role="combobox"], div[role="combobox"]').first();
          if (await control.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log(`[LOCATE] Found by DOM traversal from label`);
            return { element: control, type: await determineControlType(control) };
          }
        }
        return null;
      }
    ];
    
    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result) return result;
      } catch (e) {
        console.log(`[LOCATE] Strategy failed: ${e.message}`);
      }
    }
    
    console.log(`[LOCATE] Could not locate control for: "${labelText}"`);
    return null;
  };
  
  // Helper: Determine control type
  const determineControlType = async (element) => {
    const tagName = await element.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
    const role = await element.getAttribute('role').catch(() => '');
    const type = await element.getAttribute('type').catch(() => '');

    console.log(`[TYPE] Element: ${tagName}, role: ${role}, type: ${type}`);

    // IMPORTANT:
    // Handshake uses readonly <select> elements as backing elements
    // for its custom dropdowns.
    if (tagName === 'select') {
      const readonly = await element.getAttribute('readonly').catch(() => null);

      if (readonly !== null) {
        console.log('[TYPE] Readonly select detected — treating as custom-combobox');
        return 'custom-combobox';
      }

      return 'native-select';
    }

    if (role === 'combobox') return 'custom-combobox';
    if (role === 'listbox') return 'custom-listbox';
    if (tagName === 'input' && type === 'text') return 'text-input';
    if (tagName === 'input' && type === 'tel') return 'tel-input';
    if (tagName === 'input' && type === 'email') return 'email-input';
    if (tagName === 'input' && type === 'url') return 'url-input';
    if (tagName === 'textarea') return 'textarea';
    if (tagName === 'input' && type === 'checkbox') return 'checkbox';
    if (tagName === 'input' && type === 'file') return 'file-input';

    return 'unknown';
  };
  
  // Helper: Fill text input
  const fillTextInput = async (control, value, label) => {
    console.log(`[FILL] Text input "${label}" with value: "${value}"`);
    
    try {
      await control.click();
      await control.fill('');
      await control.fill(value);
      
      // Verify
      const filledValue = await control.inputValue();
      if (normalizeText(filledValue) === normalizeText(value)) {
        console.log(`[VERIFY] ✅ Text input filled correctly`);
        return true;
      } else {
        console.log(`[VERIFY] ❌ Text input verification failed. Expected: "${value}", Got: "${filledValue}"`);
        return false;
      }
    } catch (e) {
      console.log(`[FILL] ❌ Error filling text input: ${e.message}`);
      return false;
    }
  };
  
  // Helper: Select from native dropdown
  const selectNativeDropdown = async (control, value, label) => {
    console.log(`[SELECT] Native dropdown "${label}" with value: "${value}"`);
    
    try {
      await control.selectOption({ label: value }).catch(() => control.selectOption(value));
      
      // Verify
      const selectedValue = await control.inputValue();
      console.log(`[VERIFY] Selected value: "${selectedValue}"`);
      console.log(`[VERIFY] ✅ Native dropdown selection complete`);
      return true;
    } catch (e) {
      console.log(`[SELECT] ❌ Error selecting from native dropdown: ${e.message}`);
      return false;
    }
  };
  
  // Helper: Select from custom dropdown/combobox
  const selectCustomDropdown = async (control, value, label) => {
    console.log(`[SELECT] Custom dropdown "${label}" with value: "${value}"`);

    try {
      let trigger = control;

      // Handshake uses a readonly <select> as a backing element.
      // The actual clickable element is the visible div[role="combobox"].
      const tagName = await control
        .evaluate(el => el.tagName.toLowerCase())
        .catch(() => '');

      const readonly = await control
        .getAttribute('readonly')
        .catch(() => null);

      if (tagName === 'select' && readonly !== null) {
        const selectId = await control.getAttribute('id');

        console.log(
          `[SELECT] Backing readonly select detected: #${selectId}` 
        );

        // Find the real visible combobox associated with this select.
        const realCombobox = page.locator(
          `[role="combobox"][aria-controls="listbox-${selectId}"]:visible` 
        ).first();

        if (await realCombobox.count() === 0) {
          console.log(
            `[SELECT] ❌ Visible combobox not found for #${selectId}` 
          );
          return false;
        }

        trigger = realCombobox;

        console.log(
          `[SELECT] ✅ Using visible combobox instead of readonly select` 
        );
      }

      // Make sure the actual clickable element is visible.
      await trigger.waitFor({
        state: 'visible',
        timeout: 5000
      });

      // Click the REAL dropdown trigger.
      await trigger.click();

      // Wait for dropdown rendering.
      await page.waitForTimeout(300);

      // Only inspect visible options.
      const options = page.locator(
        '[role="option"]:visible'
      );

      const optionCount = await options.count();

      console.log(
        `[OPTIONS] Found ${optionCount} visible options` 
      );

      const targetValue = normalizeText(value);

      let matchedOption = null;

      for (let i = 0; i < optionCount; i++) {

        const option = options.nth(i);

        const optionText = (
          await option.textContent().catch(() => '')
        ).trim();

        const normalizedOption = normalizeText(optionText);

        // Exact match first.
        if (normalizedOption === targetValue) {
          matchedOption = option;

          console.log(
            `[OPTIONS] Exact match found: "${optionText}"` 
          );

          break;
        }
      }

      // If exact match wasn't found, use partial matching
      // for the other dropdowns.
      if (!matchedOption) {

        for (let i = 0; i < optionCount; i++) {

          const option = options.nth(i);

          const optionText = (
            await option.textContent().catch(() => '')
          ).trim();

          const normalizedOption = normalizeText(optionText);

          if (normalizedOption.includes(targetValue)) {

            matchedOption = option;

            console.log(
              `[OPTIONS] Partial match: "${optionText}"` 
            );

            break;
          }
        }
      }

      if (!matchedOption) {

        console.log(
          `[OPTIONS] ❌ No matching option found for "${value}"` 
        );

        await page.keyboard.press('Escape').catch(() => {});

        return false;
      }

      // Click the actual visible option.
      await matchedOption.click();

      await page.waitForTimeout(300);

      console.log(
        `[VERIFY] ✅ Custom dropdown selection complete` 
      );

      return true;

    } catch (e) {

      console.log(
        `[SELECT] ❌ Error selecting custom dropdown: ${e.message}` 
      );

      return false;
    }
  };
  
  // Helper: Check checkbox
  const checkCheckbox = async (control, label) => {
    console.log(`[CHECK] Checkbox "${label}"`);
    
    try {
      const isChecked = await control.isChecked();
      if (!isChecked) {
        await control.check();
        console.log(`[VERIFY] ✅ Checkbox checked`);
      } else {
        console.log(`[VERIFY] ✅ Checkbox already checked`);
      }
      return true;
    } catch (e) {
      console.log(`[CHECK] ❌ Error checking checkbox: ${e.message}`);
      return false;
    }
  };
  
  // Helper: Wait for UI update after dependent field selection
  const waitForUIUpdate = async (expectedFieldLabel) => {
    console.log(`[WAIT] Waiting for UI update for field: "${expectedFieldLabel}"`);
    
    const maxWait = 10000; // 10 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const fieldFound = await findFieldByLabel([expectedFieldLabel]);
      if (fieldFound) {
        console.log(`[WAIT] ✅ Field appeared: "${expectedFieldLabel}"`);
        return true;
      }
      await page.waitForTimeout(500);
    }
    
    console.log(`[WAIT] ⚠️ Timeout waiting for field: "${expectedFieldLabel}"`);
    return false;
  };
  
  // Field definitions with semantic keywords
  const fieldDefinitions = [
    {
      keywords: ['field', 'background', 'describes'],
      value: profile.major || 'Engineering',
      type: 'dropdown'
    },
    {
      keywords: ['sub-field', 'subfield', 'sub field'],
      value: profile.subField || 'Aerospace engineering',
      type: 'multi-select'
    },
    {
      keywords: ['current', 'role'],
      value: profile.currentRole || 'Computer and Information Systems Managers',
      type: 'dropdown'
    },
    {
      keywords: ['school', 'attend'],
      value: 'Other',
      type: 'dropdown',
      dependentField: {
        keywords: ['school', 'name', 'share'],
        value: profile.schoolName || 'AVNIET',
        type: 'text'
      }
    },
    {
      keywords: ['highest', 'level', 'education'],
      value: profile.educationLevel || 'Bachelors',
      type: 'dropdown'
    },
    {
      keywords: ['graduate', 'graduation', 'year'],
      value: String(profile.gradYear || 2026),
      type: 'dropdown'
    },
    {
      keywords: ['linkedin', 'url'],
      value: profile.linkedinUrl || 'randomuser.lindin.com/9498893',
      type: 'text'
    },
    {
      keywords: ['country', 'located'],
      value: profile.country || 'India',
      type: 'dropdown'
    },
    {
      keywords: ['hear', 'about', 'us'],
      value: profile.heardAboutUs || 'Google',
      type: 'dropdown'
    }
  ];
  
  // Wait for form to be ready
  console.log('[INIT] Waiting for onboarding form to be ready...');
  await page.waitForFunction(
    () => document.querySelector('input, select, [role="combobox"]') !== null,
    { timeout: 15000 }
  ).catch(() => console.log('[INIT] Form elements not detected, proceeding anyway...'));
  await page.waitForTimeout(2000);
  
  // Process fields in strict order
  for (const fieldDef of fieldDefinitions) {
    if (!(await isPageValid())) {
      console.log('[ERROR] Page context invalid, stopping automation');
      break;
    }
    
    console.log(`\n[FIELD] Processing field with keywords: ${fieldDef.keywords.join(', ')}`);
    
    // Find field by label
    const labelText = await findFieldByLabel(fieldDef.keywords);
    if (!labelText) {
      console.log(`[FIELD] ⚠️ Field not found, skipping`);
      continue;
    }
    
    // Locate control
    const controlInfo = await locateControl(labelText);
    if (!controlInfo) {
      console.log(`[FIELD] ⚠️ Control not located, skipping`);
      continue;
    }
    
    const { element: control, type: controlType } = controlInfo;
    console.log(`[FIELD] Control type: ${controlType}`);
    
    // Fill based on control type
    let success = false;
    
    if (fieldDef.type === 'text' && (controlType === 'text-input' || controlType === 'url-input')) {
      success = await fillTextInput(control, fieldDef.value, labelText);
    } else if (fieldDef.type === 'dropdown' && controlType === 'native-select') {
      success = await selectNativeDropdown(control, fieldDef.value, labelText);
    } else if (fieldDef.type === 'dropdown' && (controlType === 'custom-combobox' || controlType === 'custom-listbox')) {
      success = await selectCustomDropdown(control, fieldDef.value, labelText);
    } else if (fieldDef.type === 'multi-select') {
      // Handle multi-select by splitting values
      const values = fieldDef.value.split(',').map(v => v.trim()).filter(Boolean);
      for (const val of values) {
        if (controlType === 'custom-combobox') {
          await selectCustomDropdown(control, val, labelText);
        }
        await page.waitForTimeout(300);
      }
      success = true;
    } else {
      console.log(`[FIELD] ⚠️ Control type mismatch: expected ${fieldDef.type}, got ${controlType}`);
    }
    
    if (success) {
      console.log(`[FIELD] ✅ Field processed successfully`);
      
      // Handle dependent field
      if (fieldDef.dependentField) {
        console.log(`[DEPENDENT] Waiting for dependent field...`);
        const dependentAppeared = await waitForUIUpdate(fieldDef.dependentField.keywords[0]);
        
        if (dependentAppeared) {
          const depLabelText = await findFieldByLabel(fieldDef.dependentField.keywords);
          if (depLabelText) {
            const depControlInfo = await locateControl(depLabelText);
            if (depControlInfo) {
              await fillTextInput(depControlInfo.element, fieldDef.dependentField.value, depLabelText);
            }
          }
        }
      }
    } else {
      console.log(`[FIELD] ❌ Field processing failed`);
    }
    
    await page.waitForTimeout(1000);
  }
  
  // Handle terms checkbox
  console.log(`\n[FIELD] Processing terms checkbox`);
  const termsKeywords = ['terms', 'privacy', 'contractor', 'agreement'];
  const termsLabel = await findFieldByLabel(termsKeywords);
  
  if (termsLabel) {
    const termsControlInfo = await locateControl(termsLabel);
    if (termsControlInfo && termsControlInfo.type === 'checkbox') {
      await checkCheckbox(termsControlInfo.element, termsLabel);
    }
  }
  
  // 1. Resume File Upload (input[data-testid="resume-field-file-input"])
  const resumePath = profile.resumePath || path.resolve(__dirname, '../../test-resume.pdf');
  if (!fs.existsSync(resumePath)) {
    const minPdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj ' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
      '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
      '0000000058 00000 n\n0000000115 00000 n\n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n217\n%%EOF';
    fs.writeFileSync(resumePath, minPdf);
  }
  try {
    const resumeInput = page.locator('input[data-testid="resume-field-file-input"], input[type="file"]').first();
    await resumeInput.waitFor({ state: 'attached', timeout: 5000 });
    await resumeInput.setInputFiles(resumePath);
    console.log(`✅ Uploaded resume file: ${path.basename(resumePath)}`);
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('⚠️  Resume file input not found or upload skipped:', e.message);
  }

  // Auto-submit after resume upload
  console.log(`[SUBMIT] Auto-submitting after resume upload...`);
  const submitButton = page.locator('button[data-testid="expertise-step-next"], button:has-text("Next"), button:has-text("Continue"), button:has-text("Submit"), button[type="submit"]').first();
  if (await submitButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitButton.click();
    console.log(`[SUBMIT] ✅ Submit button clicked automatically after resume upload`);
    await page.waitForTimeout(3000);
  } else {
    console.log(`[SUBMIT] ⚠️ Submit button not found after resume upload`);
  }
  
  // Save to CSV
  console.log(`\n[CSV] Saving onboarding data...`);
  const csvWriter = createObjectCsvWriter({
    path: 'captured_details.csv',
    header: [
      { id: 'runId', title: 'RUN_ID' },
      { id: 'email', title: 'EMAIL' },
      { id: 'firstName', title: 'FIRST_NAME' },
      { id: 'lastName', title: 'LAST_NAME' },
      { id: 'mobileNumber', title: 'MOBILE_NUMBER' },
      { id: 'background', title: 'BACKGROUND' },
      { id: 'subFields', title: 'SUB_FIELDS' },
      { id: 'currentRole', title: 'CURRENT_ROLE' },
      { id: 'schoolName', title: 'SCHOOL_NAME' },
      { id: 'educationLevel', title: 'EDUCATION_LEVEL' },
      { id: 'graduationYear', title: 'GRADUATION_YEAR' },
      { id: 'linkedinUrl', title: 'LINKEDIN_URL' },
      { id: 'country', title: 'COUNTRY' },
      { id: 'hearAboutUs', title: 'HEAR_ABOUT_US' },
      { id: 'status', title: 'STATUS' },
      { id: 'timestamp', title: 'TIMESTAMP' },
    ],
    append: true,
  });
  
  await csvWriter.writeRecords([{
    runId: runId || 'N/A',
    email: userData.email,
    firstName: userData.firstName,
    lastName: userData.lastName,
    mobileNumber: userData.mobileNumber,
    background: profile.major,
    subFields: profile.subField,
    currentRole: profile.currentRole,
    schoolName: profile.schoolName,
    educationLevel: profile.educationLevel,
    graduationYear: profile.gradYear,
    linkedinUrl: profile.linkedinUrl,
    country: profile.country,
    hearAboutUs: profile.heardAboutUs,
    status: 'SUCCESS',
    timestamp: new Date().toISOString(),
  }]);
  
  console.log(`\n[COMPLETE] ✅ Onboarding autofill completed successfully!`);
  clearState();
}

// ---------- State Persistence Functions ----------
const STATE_FILE = path.join(__dirname, '../../bot-state.json');

// Save current state to file
function saveState(runId, step, data) {
  try {
    const state = {
      runId,
      step,
      data,
      timestamp: new Date().toISOString(),
      lastUpdated: Date.now()
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`💾 State saved: Step ${step} at ${new Date().toISOString()}`);
  } catch (e) {
    console.log('⚠️  Could not save state:', e.message);
  }
}

// Load state from file
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log(`📂 State loaded: Step ${state.step} from ${state.timestamp}`);
      return state;
    }
  } catch (e) {
    console.log('⚠️  Could not load state:', e.message);
  }
  return null;
}

// Clear state file
function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      console.log('🗑️  State cleared');
    }
  } catch (e) {
    console.log('⚠️  Could not clear state:', e.message);
  }
}

// Helper function to select from dropdown
async function selectDropdown(page, label, value) {
  console.log(`📋 Selecting "${value}" for "${label}"...`);
  
  try {
    // Try multiple strategies to find and select dropdown
    const strategies = [
      // Strategy 1: Find by label text and click option
      async () => {
        const labelElement = await page.locator(`text=${label}`).first();
        if (await labelElement.isVisible()) {
          const parent = labelElement.locator('..');
          const dropdown = parent.locator('select, [role="combobox"], .dropdown').first();
          if (await dropdown.isVisible()) {
            await dropdown.selectOption({ label: value });
            return true;
          }
        }
        return false;
      },
      
      // Strategy 2: Find select by name/placeholder
      async () => {
        const selectors = [
          `select[name*="${label.toLowerCase()}"]`,
          `select[placeholder*="${label.toLowerCase()}"]`,
          `select[aria-label*="${label.toLowerCase()}"]`,
          `[role="combobox"][aria-label*="${label.toLowerCase()}"]`
        ];
        
        for (const selector of selectors) {
          try {
            const dropdown = await page.locator(selector).first();
            if (await dropdown.isVisible()) {
              await dropdown.selectOption({ label: value });
              return true;
            }
          } catch (e) {
            // Try next selector
          }
        }
        return false;
      },
      
      // Strategy 3: Click dropdown and select from options
      async () => {
        const dropdowns = await page.$$('select, [role="combobox"], .dropdown');
        for (const dropdown of dropdowns) {
          try {
            if (await dropdown.isVisible()) {
              await dropdown.click();
              await page.waitForTimeout(500);
              
              const options = await page.$$('option, [role="option"]');
              for (const option of options) {
                try {
                  const text = await option.textContent();
                  if (text && text.toLowerCase().includes(value.toLowerCase())) {
                    await option.click();
                    return true;
                  }
                } catch (e) {
                  // Continue to next option
                }
              }
            }
          } catch (e) {
            // Continue to next dropdown
          }
        }
        return false;
      }
    ];
    
    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result) {
          console.log(`✅ Selected "${value}" for "${label}"`);
          return true;
        }
      } catch (e) {
        // Try next strategy
      }
    }
    
    console.log(`⚠️  Could not select "${value}" for "${label}" - may need manual selection`);
    return false;
  } catch (e) {
    console.log(`⚠️  Error selecting dropdown: ${e.message}`);
    return false;
  }
}

// ---- helper: poll a field until the human has typed something into it ----
async function waitForManualFill(page, selector, timeoutMs = 5 * 60 * 1000, fieldType = 'email') {
  const start = Date.now();
  const pollInterval = 2000; // check every 2 seconds
  let lastValue = '';
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    // Handle multiple selectors separated by comma
    const selectors = selector.split(',').map(s => s.trim());
    let value = '';
    
    for (const sel of selectors) {
      try {
        const tempValue = await page.locator(sel).inputValue().catch(() => '');
        if (tempValue && tempValue.trim().length > 0) {
          value = tempValue;
          break; // Use first non-empty value found
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    // Debug: log current value for all non-empty values
    if (value && value.trim().length > 0) {
      console.log(`Current value in ${selector}: "${value}" (length: ${value.length}, type: ${fieldType})`);
    }
    
    // Different validation for different field types
    let isValid = false;
    if (fieldType === 'otp') {
      // OTP: accept any numeric value with 6 digits
      isValid = value && value.trim().length === 6 && /^\d+$/.test(value.trim());
    } else if (fieldType === 'phone') {
      // Phone: accept 10-digit numbers (more lenient - allow any 10+ digit number)
      isValid = value && value.trim().length >= 10;
    } else if (fieldType === 'text') {
      // Text fields: accept any non-empty value with at least 2 characters
      isValid = value && value.trim().length >= 2;
    } else {
      // Email: accept if contains @
      isValid = value && value.trim().length > 0 && value.includes('@');
    }
    
    // Only accept if value has been stable for 2 checks (debounce)
    if (isValid) {
      if (value === lastValue) {
        stableCount++;
        if (stableCount >= 2) {
          console.log(`Detected stable entry in ${selector}: "${value}"`);
          return value;
        }
      } else {
        stableCount = 0;
      }
      lastValue = value;
    }
    await page.waitForTimeout(pollInterval);
  }
  throw new Error(`Timed out waiting for manual entry in ${selector}`);
}

// ---- helper: wait until MULTIPLE fields are all filled (for the details screen) ----
async function waitForAllFieldsFilled(page, selectors, timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < timeoutMs) {
    const values = {};
    let allFilled = true;

    for (const [key, selector] of Object.entries(selectors)) {
      const value = await page.locator(selector).inputValue().catch(() => '');
      values[key] = value;
      if (!value || value.trim().length === 0) allFilled = false;
    }

    if (allFilled) {
      console.log('All detail fields filled:', values);
      return values;
    }
    await page.waitForTimeout(pollInterval);
  }
  throw new Error('Timed out waiting for all detail fields to be filled');
}

// ---- main flow ----
async function runManualGuidedLogin(runId, profile = defaultProfile, existingPage = null) {
  // Clear any stale file state for fresh run
  clearState();

  let browser = null;
  let page = existingPage;

  if (!page) {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page = await context.newPage();
  }

  page.on('domcontentloaded', async () => {
    console.log('🔄 Page loaded/reloaded. Current URL:', page.url());
  });

  page.on('error', (error) => {
    console.log('⚠️  Page error:', error.message);
  });

  let email = profile.studentEmail;
  let firstName = profile.firstName;
  let lastName = profile.lastName;
  let mobileNumber = profile.phone;
  let linkedinUrl = profile.linkedinUrl || 'N/A';
  let school = profile.schoolName || 'University of Engineering';

  if (!email || !firstName || !lastName || !mobileNumber) {
    throw new Error('Bot profile is missing required fields (email, firstName, lastName, phone). Set bot/.env.');
  }

  if (!email || !firstName || !lastName || !mobileNumber) {
    throw new Error('Bot profile is missing required fields (email, firstName, lastName, phone). Set bot/.env.');
  }
  
  // Onboarding data variables (declare outside try block for error handling)
  let backgroundValue = '';
  let subFieldValue = '';
  let roleValue = '';
  let schoolValue = '';
  let educationLevel = '';
  let gradYear = '';
  let countryValue = '';
  let hearAboutUsValue = '';
  let linkedinFromProfile = '';

  try {
    // STEP 1 — Navigate to access page and auto-fill email
    console.log('Navigating to Handshake access page...');
    await page.goto('https://app.joinhandshake.com/access?destination_hai_path=%2Fauth%3FredirectTo%3D%252Ffellow%252Fonboarding', { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    
    const emailSelector = 'input[name="email"], input[type="email"], input[placeholder*="email" i]';
    const emailField = page.locator(emailSelector).first();
    
    try {
      await emailField.waitFor({ state: 'visible', timeout: 15000 });
      console.log(`STEP 1: Auto-filling email: ${email}`);
      await emailField.fill(email);
      await page.waitForTimeout(1000);
    } catch (err) {
      console.log('STEP 1: Email field not detected immediately, waiting for entry...');
      email = await waitForManualFill(page, emailSelector);
    }
    saveState(runId, 1, { email });

    // STEP 2 — bot auto-clicks submit
    console.log('STEP 2: Auto-clicking submit / Continue with email...');
    const submitBtnSelectors = [
      'button:has-text("Continue with email")',
      'button[type="submit"]',
      'button:has-text("Continue")',
      'button:has-text("Next")'
    ];
    let submitClicked = false;
    for (const sel of submitBtnSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible()) {
          await btn.click();
          console.log(`✅ Clicked submit button: ${sel}`);
          submitClicked = true;
          break;
        }
      } catch (e) {}
    }
    if (!submitClicked) {
      console.log('Pressing Enter to submit email form...');
      await emailField.press('Enter');
    }
    await page.waitForTimeout(4000);
    saveState(runId, 2, { email });

    // STEP 3 — auto-select "Send one-time code" if present
    console.log('STEP 3: Checking for "Send one-time code" button...');
    const otpButtonSelectors = [
      'button:has-text("Send one-time code")',
      'button:has-text("Send code")',
      'button:has-text("One-time code")',
      'button:has-text("Email me a code")'
    ];
    for (const sel of otpButtonSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible()) {
          await btn.click();
          console.log(`✅ Clicked: ${sel}`);
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {}
    }
    
    // Wait for navigation to OTP page
    await page.waitForTimeout(3000);

    // STEP 4 — prompt operator in terminal for the EMAIL verification code
    console.log('STEP 4: Prompting for email verification code in terminal...');
    const code = await promptOtp('Enter OTP: ');
    console.log(`✅ Email OTP entered: ${code}`);

    // STEP 5 — bot injects code and auto-clicks verify
    console.log('STEP 5: Injecting code into passcode field and auto-clicking Verify...');
    const emailPasscodeSelectors = 'input[name="passcode"], input[name="code"], input[name="otp"], input[autocomplete="one-time-code"], input[placeholder*="code" i]';
    await page.locator(emailPasscodeSelectors).first().fill(code);
    await page.waitForTimeout(500);
    await page.click('button:has-text("Verify")');
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1500);
    saveState(runId, 5, { email });

    // Check if we moved away from the access/OTP screen or reached onboarding
    const postEmailUrl = page.url();
    console.log('Current URL after Email OTP:', postEmailUrl);

    const otpInputSelectors = 'input[name="passcode"], input[name="code"], input[name="otp"], input[autocomplete="one-time-code"]';
    const otpStillPresent = await page.locator(otpInputSelectors).first().isVisible({ timeout: 1000 }).catch(() => false);
    const onboardingFieldSelector = 'input[name="first_name"], input[placeholder*="first" i], select[name="field"], select[name="background"], input[name="school"]';
    const onboardingFieldsVisible = await page.locator(onboardingFieldSelector).first().isVisible({ timeout: 1500 }).catch(() => false);

    let skippedToOnboarding = false;
    if (!postEmailUrl.includes('/access') || !otpStillPresent || postEmailUrl.includes('onboarding') || postEmailUrl.includes('stu') || onboardingFieldsVisible) {
      console.log('⏩ Page moved away from access/OTP screen or reached onboarding. Skipping mobile number/SMS verification (Steps 6-7).');
      skippedToOnboarding = true;
    }

    const mobileSelectors = ['input[type="tel"]', 'input[name="phone"]', 'input[name="mobile"]', 'input[placeholder*="phone" i]', 'input[placeholder*="mobile" i]', 'input[name="phoneNumber"]'];
    let currentMobileValue = '';
    let mobileInputField = null;

    if (!skippedToOnboarding) {
      // STEP 6 — Mobile number entry with immediate auto-submit
      console.log('STEP 6: Checking for mobile number page...');
      
      // CRITICAL FIX: Check URL first to see if we're already past mobile verification
      const step6Url = page.url();
      console.log('Current URL at Step 6:', step6Url);
      
      if (step6Url.includes('/fellow/onboarding') || step6Url.includes('/fellow/dashboard')) {
        console.log('✅ Mobile already verified for this account — skipping mobile step entirely.');
        skippedToOnboarding = true;
      } else {
        try {
          // First, check if we're on a mobile number page and auto-click "Send code" if present
          await page.waitForTimeout(2000);
          
          // Try to find and click "Send code" button first
          try {
            const sendCodeSelectors = [
              'button:has-text("Send code")',
              'button:has-text("Send one-time code")',
              'button:has-text("Send verification code")',
              'button:has-text("Send SMS")'
            ];
            
            let sendCodeClicked = false;
            for (const selector of sendCodeSelectors) {
              try {
                const button = await page.locator(selector).first();
                if (await button.isVisible()) {
                  await button.click();
                  console.log(`✅ Clicked "Send code" button via: ${selector}`);
                  sendCodeClicked = true;
                  await page.waitForTimeout(3000);
                  break;
                }
              } catch (e) {
                // Try next selector
              }
            }
            
            if (!sendCodeClicked) {
              console.log('No "Send code" button found, proceeding to mobile number entry...');
            }
          } catch (e) {
            console.log('Could not find "Send code" button, continuing...');
          }
      
          // Auto-fill mobile number if available
          const targetPhone = profile?.phone || defaultProfile.phone;
          if (!targetPhone) {
            throw new Error('Bot profile phone is required for OTP flows. Set BOT_PHONE in bot/.env.');
          }
          for (const selector of mobileSelectors) {
            try {
              const field = await page.locator(selector).first();
              if (await field.isVisible()) {
                console.log(`STEP 6b: Auto-filling mobile number: ${targetPhone}`);
                await field.fill(targetPhone);
                currentMobileValue = targetPhone;
                mobileInputField = field;
                break;
              }
            } catch (e) {}
          }

          // Now wait for mobile number entry with immediate auto-submit
          console.log('STEP 6b: Checking mobile number (10 digits)...');
          let mobileAttempts = 0;
          const maxMobileAttempts = 150; // 5 minutes with 2-second intervals
          
          while (mobileAttempts < maxMobileAttempts && mobileNumber === 'N/A') {
            mobileAttempts++;
            
            if (!currentMobileValue) {
              for (const selector of mobileSelectors) {
                try {
                  const field = await page.locator(selector).first();
                  if (await field.isVisible()) {
                    const tempValue = await field.inputValue().catch(() => '');
                    if (tempValue && tempValue.trim().length > 0) {
                      currentMobileValue = tempValue;
                      mobileInputField = field;
                      break;
                    }
                  }
                } catch (e) {}
              }
            }
            
            // Debug logging
            if (currentMobileValue && currentMobileValue.trim().length > 0) {
              console.log(`📱 Mobile number entered: ${currentMobileValue} (${currentMobileValue.length} digits)`);
            }
            
            // Validate mobile number (10+ digits) - IMMEDIATE AUTO-SUBMIT
            if (currentMobileValue && currentMobileValue.trim().length >= 10) {
              mobileNumber = currentMobileValue;
              console.log(`✅ Mobile number detected (10+ digits): ${mobileNumber}`);
              console.log('STEP 6c: Auto-submitting immediately...');
              saveState(runId, 6, { email, mobileNumber });
              
              // Wait a moment for stability
              await page.waitForTimeout(500);
              
              let submitted = false;
              
              // METHOD 1: Try pressing Enter on the input field
              try {
                if (mobileInputField) {
                  await mobileInputField.press('Enter');
                  console.log('✅ Mobile number submitted via Enter key');
                  submitted = true;
                  await page.waitForTimeout(3000);
                }
              } catch (e) {
                console.log('Enter key failed, trying button click...');
              }
              
              // METHOD 2: Try multiple button selectors for submit
              if (!submitted) {
                const submitSelectors = [
                  'button[type="submit"]',
                  'button:has-text("Send code")',
                  'button:has-text("Send")',
                  'button:has-text("Continue")',
                  'button:has-text("Submit")',
                  'button:has-text("Verify")',
                  'button:has-text("Next")',
                  'button:has-text("Send Code")',
                  'button:has-text("SEND CODE")'
                ];
                
                for (const selector of submitSelectors) {
                  try {
                    await page.click(selector, { timeout: 1000 });
                    console.log(`✅ Mobile number submitted via: ${selector}`);
                    submitted = true;
                    await page.waitForTimeout(3000);
                    break;
                  } catch (e) {
                    // Try next selector
                  }
                }
              }
              
              // METHOD 3: Try to find any button with relevant text
              if (!submitted) {
                console.log('⚠️  Standard selectors failed, searching for any button...');
                try {
                  const buttons = await page.$$('button');
                  for (const button of buttons) {
                    try {
                      const text = await button.textContent();
                      if (text && (text.toLowerCase().includes('send') || text.toLowerCase().includes('continue') || text.toLowerCase().includes('submit') || text.toLowerCase().includes('verify') || text.toLowerCase().includes('next'))) {
                        await button.click();
                        console.log(`✅ Mobile number submitted via button text: "${text}"`);
                        submitted = true;
                        await page.waitForTimeout(3000);
                        break;
                      }
                    } catch (e) {
                      // Continue to next button
                    }
                  }
                } catch (e) {
                  console.log('⚠️  Button search failed...');
                }
              }
              
              // METHOD 4: Try clicking any form and submitting
              if (!submitted) {
                console.log('⚠️  Trying form submission...');
                try {
                  await page.keyboard.press('Enter');
                  console.log('✅ Mobile number submitted via global Enter');
                  submitted = true;
                  await page.waitForTimeout(3000);
                } catch (e) {
                  console.log('Global Enter failed...');
                }
              }
              
              if (!submitted) {
                console.log('⚠️  Could not auto-submit mobile number, please submit manually...');
                console.log('Waiting 10 seconds for manual submission...');
                await page.waitForTimeout(10000);
              } else {
                console.log('✅ Mobile number submission completed');
              }
              
              break; // Exit the loop after submission attempt
            }
            
            await page.waitForTimeout(2000);
          }
          
          if (mobileNumber === 'N/A') {
            console.log('Mobile number not entered within timeout, continuing to details...');
          }
        } catch (e) {
          console.log('Mobile number step not found or failed, continuing to details...');
        }
      }
    }
    
    // STEP 7 — Mobile verification (OTP), mirrors the email OTP flow in STEP 4-5 exactly
    // Only run if we didn't skip mobile step
    if (!skippedToOnboarding) {
      console.log('STEP 7: Checking for mobile verification code...');
      await page.waitForTimeout(2000);

      const mobilePasscodeSelectors = [
        'input[name="passcode"]',
        'input[name="code"]',
        'input[name="otp"]',
        'input[name*="passcode" i]',
        'input[name*="verification" i]',
        'input[autocomplete="one-time-code"]',
        'input[placeholder*="code" i]'
      ];

      let mobileOtpInputSelector = 'input[name="passcode"]';
      for (const sel of mobilePasscodeSelectors) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          mobileOtpInputSelector = sel;
          break;
        }
      }

      console.log('\n===============================================================');
      console.log('🔔 [ACTION REQUIRED] Please enter the MOBILE verification code in the browser.');
      console.log('   The bot is listening and will AUTO-SUBMIT as soon as you type it.');
      console.log('===============================================================\n');

      let mobileOtp = '';
      let mobileAttempts = 0;
      const maxMobileOtpAttempts = 150; // 5 minutes with 2-second intervals

      while (mobileAttempts < maxMobileOtpAttempts && !mobileOtp) {
        mobileAttempts++;
        let value = '';

        for (const sel of mobilePasscodeSelectors) {
          const temp = await page.locator(sel).first().inputValue().catch(() => '');
          if (temp && temp.trim().length > 0) {
            value = temp;
            mobileOtpInputSelector = sel;
            break;
          }
        }

        if (value && value.trim().length === 6 && /^\d+$/.test(value.trim())) {
          console.log(`📱 Mobile code entered: ${value}`);
          // Instant detection without debounce
          mobileOtp = value;
          console.log(`✅ Instant mobile code confirmed: ${mobileOtp}`);
        } else if (value && value.trim().length > 0) {
          console.log(`⏳ Mobile code being entered: ${value} (${value.length} digits)`);
        }

        if (!mobileOtp) {
          await page.waitForTimeout(500);
        }
      }

      if (!mobileOtp) {
        console.log('⚠️ No mobile verification code entered within timeout or page already advanced, checking next step...');
      } else {
        // STEP 7b — bot auto-clicks verify (same as STEP 5)
        console.log('STEP 7b: Code detected. Auto-clicking Verify...');
        let verifyClicked = false;
        const verifyButtonSelectors = [
          'button:has-text("Verify")',
          'button:has-text("Submit")',
          'button:has-text("Continue")',
          'button:has-text("Next")',
          'button[type="submit"]'
        ];

        for (const btnSel of verifyButtonSelectors) {
          try {
            const btn = page.locator(btnSel).first();
            if (await btn.isVisible()) {
              await btn.click();
              console.log(`✅ Clicked verify button via: ${btnSel}`);
              verifyClicked = true;
              break;
            }
          } catch (e) {
            // Try next button
          }
        }

        if (!verifyClicked) {
          try {
            await page.keyboard.press('Enter');
            console.log('✅ Pressed Enter to submit mobile verification code');
          } catch (e) {
            console.log('Enter key failed');
          }
        }

        await page.waitForTimeout(5000);
        saveState(runId, 7, { email, mobileNumber });

        // STEP 7c — Check for verification error
        console.log('STEP 7c: Checking if mobile verification succeeded...');
        const mobileVerificationError = await page.locator('text=incorrect, text=invalid, text=wrong, text=error, text=expired').count() > 0;

        if (mobileVerificationError) {
          console.log('❌ Mobile verification failed or wrong code. Waiting for correct code...');
          console.log('⚠️  Please enter the correct mobile verification code.');

          let correctMobileOtp = '';
          let retryAttempts = 0;
          const maxRetries = 30; // 1 minute with 2-second intervals

          while (retryAttempts < maxRetries && !correctMobileOtp) {
            retryAttempts++;
            let newValue = '';

            for (const sel of mobilePasscodeSelectors) {
              const temp = await page.locator(sel).first().inputValue().catch(() => '');
              if (temp && temp.trim().length > 0) {
                newValue = temp;
                break;
              }
            }

            if (newValue && newValue.trim().length === 6 && /^\d+$/.test(newValue.trim()) && newValue !== mobileOtp) {
              console.log(`📱 New mobile code entered: ${newValue}`);
              correctMobileOtp = newValue;
              console.log(`✅ New instant mobile code: ${correctMobileOtp}`);
            }

            if (!correctMobileOtp) {
              await page.waitForTimeout(500);
            }
          }

          if (correctMobileOtp) {
            console.log('STEP 7d: Auto-clicking Verify with new mobile code...');
            for (const btnSel of verifyButtonSelectors) {
              try {
                const btn = page.locator(btnSel).first();
                if (await btn.isVisible()) {
                  await btn.click();
                  break;
                }
              } catch (e) {
                // Try next button
              }
            }
            await page.waitForTimeout(5000);
          }
        } else {
          console.log('✅ Mobile verification successful!');
        }
      }
    } else {
      console.log('✅ Mobile verification skipped (already verified or not required).');
    }
    
    // STEP 8 — Name and surname
    const currentStep8Url = page.url();
    const isAlreadyPostAuth = currentStep8Url.includes('/fellow/') || currentStep8Url.includes('/stu/') || currentStep8Url.includes('dashboard') || currentStep8Url.includes('onboarding');
    
    if (!isAlreadyPostAuth) {
      console.log('STEP 8: Checking name fields...');
      const firstNameSelector = 'input[name="first_name"], input[placeholder*="first" i]';
      const lastNameSelector = 'input[name="last_name"], input[placeholder*="last" i]';

      const fnField = page.locator(firstNameSelector).first();
      if (await fnField.isVisible({ timeout: 1000 }).catch(() => false)) {
        firstName = profile.firstName;
        if (!firstName) {
          throw new Error('Bot profile firstName is required. Set BOT_FIRST_NAME in bot/.env.');
        }
        console.log('STEP 8: Auto-filling first name:', firstName);
        await fnField.fill(firstName);
      }

      const lnField = page.locator(lastNameSelector).first();
      if (await lnField.isVisible({ timeout: 1000 }).catch(() => false)) {
        lastName = profile.lastName || 'Kumar';
        console.log('STEP 8b: Auto-filling last name:', lastName);
        await lnField.fill(lastName);
      }
      saveState(runId, 8, { email, firstName, lastName });
      
      console.log('STEP 8c: Auto-submitting name details...');
      try {
        await page.click('button[type="submit"], button:has-text("Continue"), button:has-text("Next")');
        await page.waitForTimeout(1000);
      } catch (e) {
        console.log('No submit button found, continuing...');
      }
    } else {
      console.log('✅ Name details already completed (already on dashboard/onboarding).');
    }

    // If an existingPage was provided, return user data to the caller for external flow control
    if (existingPage) {
      console.log('✅ Manual guided login steps completed on shared page. Returning control to caller...');
      return { email, firstName, lastName, mobileNumber };
    }
    
    // STEP 9 — Flow Detection and Onboarding Form Handling
    console.log('STEP 9: Detecting current flow based on URL...');
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    await page.waitForTimeout(3000);

    // Flow Detection: A/B/C cases
    if (currentUrl.includes('/fellow/onboarding')) {
      console.log(' Flow A/B detected: Onboarding page found. Running autofill routine...');
      await runOnboardingAutofill(page, profile, runId, { email, firstName, lastName, mobileNumber });
    } else if (currentUrl.includes('/fellow/dashboard') || currentUrl.includes('/stu/')) {
      console.log(' Flow C detected: Already on dashboard. Onboarding already completed. Skipping autofill.');
      console.log(' Nothing to do - user is already on dashboard.');
      return;
    } else {
      console.log(' Unknown URL state. Waiting 5 seconds to see if navigation completes...');
      await page.waitForTimeout(5000);
      const newUrl = page.url();
      if (newUrl.includes('/fellow/onboarding')) {
        console.log(' Onboarding page detected after wait. Running autofill routine...');
        await runOnboardingAutofill(page, profile, runId, { email, firstName, lastName, mobileNumber });
      } else {
        console.log('⚠️ Still not on onboarding page. Assuming Flow C or unexpected state. Skipping autofill.');
        return;
      }
    }
  } catch (err) {
    console.error('Flow error:', err.message);
    saveState(runId, -1, { 
      error: err.message, 
      email: email || '', 
      firstName: firstName || '', 
      lastName: lastName || '', 
      mobileNumber: mobileNumber || 'N/A'
    });
    throw err;
  } finally {
    if (browser) {
      await safeExit(browser);
    }
  }
}

module.exports = { runManualGuidedLogin, runOnboardingAutofill };