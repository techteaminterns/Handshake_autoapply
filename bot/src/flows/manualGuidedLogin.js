const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');

// State persistence file
const STATE_FILE = path.join(__dirname, '../../bot-state.json');
const defaultProfile = require('../fixtures/profile');

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
async function runManualGuidedLogin(runId, profile = defaultProfile) {
  // Clear any stale file state for fresh run
  clearState();

  const browser = await launchBrowser(false); // non-headless to bypass Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  page.on('domcontentloaded', async () => {
    console.log('🔄 Page loaded/reloaded. Current URL:', page.url());
  });

  page.on('error', (error) => {
    console.log('⚠️  Page error:', error.message);
  });

  let email = profile.studentEmail || 'laptap005@gmail.com';
  let firstName = profile.firstName || 'Ajith';
  let lastName = profile.lastName || 'Kumar';
  let mobileNumber = profile.phone || '8897717454';
  let linkedinUrl = profile.linkedinUrl || 'N/A';
  let school = profile.schoolName || 'University of Engineering';
  
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
    await page.goto('https://app.joinhandshake.com/access', { timeout: 60000, waitUntil: 'domcontentloaded' });
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

    // STEP 4 — wait for human to type the EMAIL verification code
    console.log('\n===============================================================');
    console.log('🔔 [ACTION REQUIRED] Please enter the EMAIL verification code in the browser.');
    console.log('   The bot is listening and will AUTO-SUBMIT as soon as you type it.');
    console.log('===============================================================\n');
    
    const emailPasscodeSelectors = [
      'input[name="passcode"]',
      'input[name="code"]',
      'input[name="otp"]',
      'input[name*="passcode" i]',
      'input[autocomplete="one-time-code"]',
      'input[placeholder*="code" i]'
    ];
    
    let code = '';
    let attempts = 0;
    const maxAttempts = 600; // 5 minutes with 500ms intervals
    
    while (attempts < maxAttempts && !code) {
      attempts++;
      for (const sel of emailPasscodeSelectors) {
        try {
          const val = await page.locator(sel).first().inputValue().catch(() => '');
          if (val && val.trim().length === 6 && /^\d+$/.test(val.trim())) {
            console.log(`📱 Code detected: ${val}`);
            // Instant detection without debounce
            code = val;
            console.log(`✅ Instant Email OTP confirmed: ${code}`);
            break;
          }
        } catch (e) {}
      }
      if (!code) await page.waitForTimeout(500);
    }
    
    if (!code) {
      throw new Error('❌ No verification code entered within timeout.');
    }

    // STEP 5 — bot auto-clicks verify
    console.log('STEP 5: Code detected. Auto-clicking Verify...');
    await page.click('button:has-text("Verify")');
    await page.waitForTimeout(5000);
    saveState(runId, 5, { email });
    
    // Check for verification error
    console.log('STEP 5b: Checking if verification succeeded...');
    const verificationError = await page.locator('text=incorrect, text=invalid, text=wrong, text=error, text=expired').count() > 0;
    const stillOnOtpPage = page.url().includes('submit-otp') || page.url().includes('passcode');
    
    if (verificationError || stillOnOtpPage) {
      console.log('❌ Verification failed or wrong code. Waiting for correct code...');
      console.log('⚠️  Please enter the correct verification code.');
      
      // Wait for correct code
      let correctCode = '';
      let retryAttempts = 0;
      const maxRetries = 30; // 1 minute with 2-second intervals
      
      while (retryAttempts < maxRetries && !correctCode) {
        retryAttempts++;
        const newValue = await page.locator('input[name="passcode"]').inputValue().catch(() => '');
        
        if (newValue && newValue.trim().length === 6 && /^\d+$/.test(newValue.trim()) && newValue !== code) {
          console.log(`📱 New code entered: ${newValue}`);
          correctCode = newValue;
          console.log(`✅ New instant code: ${correctCode}`);
        }
        
        if (!correctCode) {
          await page.waitForTimeout(500);
        }

      }
      
      if (correctCode) {
        console.log('STEP 5c: Auto-clicking Verify with new code...');
        await page.click('button:has-text("Verify")');
        await page.waitForTimeout(5000);
        
        // Final verification check
        const finalError = await page.locator('text=incorrect, text=invalid, text=wrong, text=error').count() > 0;
        const stillFailed = page.url().includes('submit-otp') || page.url().includes('passcode');
        
        if (finalError || stillFailed) {
          console.log('❌ Verification still failed. Please check your code and try again.');
          throw new Error('Verification failed after retry. Please check your verification code.');
        } else {
          console.log('✅ Verification successful!');
        }
      } else {
        throw new Error('No correct code entered within timeout. Please check your verification code.');
      }
    } else {
      console.log('✅ Verification successful!');
    }

    // Check if we skipped to onboarding
    await page.waitForTimeout(2000);
    const postEmailUrl = page.url();
    console.log('Current URL after Email OTP:', postEmailUrl);
    
    let skippedToOnboarding = false;
    if (postEmailUrl.includes('onboarding') || postEmailUrl.includes('stu')) {
      console.log('⏩ Skipped mobile number step. Already on onboarding/dashboard page.');
      skippedToOnboarding = true;
    } else {
      // Check for onboarding fields
      const fieldSelector = 'input[name="first_name"], select[name="field"], select[name="background"]';
      if (await page.locator(fieldSelector).first().isVisible({ timeout: 2000 }).catch(() => false)) {
         console.log('⏩ Onboarding fields detected. Skipped mobile number step.');
         skippedToOnboarding = true;
      }
    }

    const mobileSelectors = ['input[type="tel"]', 'input[name="phone"]', 'input[name="mobile"]', 'input[placeholder*="phone" i]', 'input[placeholder*="mobile" i]', 'input[name="phoneNumber"]'];
    let currentMobileValue = '';
    let mobileInputField = null;

    if (!skippedToOnboarding) {
      // STEP 6 — Mobile number entry with immediate auto-submit
      console.log('STEP 6: Checking for mobile number page...');
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
      const targetPhone = profile?.phone || defaultProfile.phone || '8897717454';
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
    
    // STEP 7 — Mobile verification (OTP), mirrors the email OTP flow in STEP 4-5 exactly
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
    } // End of if (!skippedToOnboarding)
    
    // STEP 8 — Name and surname
    console.log('STEP 8: Checking name fields...');
    const firstNameSelector = 'input[name="first_name"], input[placeholder*="first" i]';
    const lastNameSelector = 'input[name="last_name"], input[placeholder*="last" i]';

    const fnField = page.locator(firstNameSelector).first();
    if (await fnField.isVisible({ timeout: 5000 }).catch(() => false)) {
      firstName = profile.firstName || 'Ajith';
      console.log('STEP 8: Auto-filling first name:', firstName);
      await fnField.fill(firstName);
    }

    const lnField = page.locator(lastNameSelector).first();
    if (await lnField.isVisible({ timeout: 5000 }).catch(() => false)) {
      lastName = profile.lastName || 'Kumar';
      console.log('STEP 8b: Auto-filling last name:', lastName);
      await lnField.fill(lastName);
    }
    saveState(runId, 8, { email, firstName, lastName });
    
    console.log('STEP 8c: Auto-submitting name details...');
    try {
      await page.click('button[type="submit"], button:has-text("Continue"), button:has-text("Next")');
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('No submit button found, continuing...');
    }
    
    // STEP 9 — Final Onboarding Form (background, role, school, education, grad year, LinkedIn, country, referral)
    console.log('STEP 9: Filling final onboarding details...');
    console.log('Current URL:', page.url());
    await page.waitForTimeout(5000);

    // Helper: try to select a dropdown option
    const trySelectDropdown = async (selectors, value) => {
      if (!value) return false;
      console.log(`🔍 Trying to select "${value}" from dropdown...`);
      
      // Strategy 1: Try standard select element
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log(`Found dropdown: ${sel}`);
            await el.selectOption({ label: value }).catch(() => {});
            // If selectOption fails silently, try by value
            await el.selectOption({ value: value }).catch(() => {});
            console.log(`✅ Dropdown set [${sel}] = "${value}"`);
            return true;
          }
        } catch (e) {
          console.log(`Failed selector: ${sel}`);
        }
      }
      
      // Strategy 2: Try custom dropdown (click and select option)
      console.log(`🔍 Trying custom dropdown selection for "${value}"...`);
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log(`Found custom dropdown: ${sel}`);
            await el.click();
            await page.waitForTimeout(500);
            
            // Look for options
            const options = await page.$$('option, [role="option"], li, [data-value]');
            for (const option of options) {
              try {
                const text = await option.textContent();
                if (text && text.toLowerCase().includes(value.toLowerCase())) {
                  await option.click();
                  console.log(`✅ Custom dropdown selected [${sel}] = "${value}"`);
                  return true;
                }
              } catch (e) {
                // Continue to next option
              }
            }
          }
        } catch (e) {
          console.log(`Failed custom selector: ${sel}`);
        }
      }
      
      return false;
    };

    // Helper: try to fill text input
    const tryFillInput = async (selectors, value) => {
      if (!value) return false;
      console.log(`🔍 Trying to fill "${value}" in input...`);
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log(`Found input: ${sel}`);
            await el.fill(value);
            console.log(`✅ Input filled [${sel}] = "${value}"`);
            return true;
          }
        } catch (e) {
          console.log(`Failed selector: ${sel}`);
        }
      }
      return false;
    };

    // Helper: try to check checkbox
    const tryCheckCheckbox = async (selectors) => {
      console.log(`🔍 Trying to find and check checkbox...`);
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
            console.log(`Found checkbox: ${sel}`);
            const isChecked = await el.isChecked();
            if (!isChecked) {
              await el.check();
              console.log(`✅ Checkbox checked [${sel}]`);
            } else {
              console.log(`✅ Checkbox already checked [${sel}]`);
            }
            return true;
          }
        } catch (e) {
          console.log(`Failed selector: ${sel}`);
        }
      }
      return false;
    };

    // Wait for the onboarding form to appear
    console.log('⏳ Waiting for onboarding form elements...');
    await page.waitForFunction(
      () => document.querySelector('input, select, [role="combobox"]') !== null,
      { timeout: 30000 }
    ).catch(() => console.log('Onboarding form wait timed out, proceeding anyway...'));
    
    console.log('✅ Form elements detected, starting to fill fields...');

    // 1. Which field best describes your background? (dropdown)
    const backgroundValue = profile.major || 'Computer science';
    await trySelectDropdown(
      ['select[name="field"]', 'select[id*="field"]', 'select[placeholder*="field" i]', 'select[name="background"]'],
      backgroundValue
    );
    console.log(`✅ Background field set to: ${backgroundValue}`);

    // 2. Which sub-field(s) best describes your background? (dropdown/multi-select)
    const subFieldValue = profile.subField || 'python machinelearning html';
    // Try to fill as text or select from dropdown
    const subFieldFilled = await tryFillInput(
      ['input[name="sub_field"]', 'input[placeholder*="sub-field" i]', 'input[placeholder*="sub field" i]'],
      subFieldValue
    );
    if (!subFieldFilled) {
      await trySelectDropdown(
        ['select[name="sub_field"]', 'select[id*="sub-field"]', 'select[name="subfield"]'],
        subFieldValue.split(' ')[0] // Try first keyword
      );
    }
    console.log(`✅ Sub-field set to: ${subFieldValue}`);

    // 3. What's your current role? (text input)
    const roleValue = profile.currentRole || 'computer and information system managers';
    await tryFillInput(
      ['input[name="role"]', 'input[placeholder*="role" i]', 'input[placeholder*="current role" i]'],
      roleValue
    );
    console.log(`✅ Current role set to: ${roleValue}`);

    // 4. What school did you attend? (dropdown -> select "other" -> enter school name)
    const schoolValue = profile.schoolName || 'AVNIET';
    
    // First try to select "other" from school dropdown
    await trySelectDropdown(
      ['select[name="school"]', 'select[id*="school"]', 'select[name="school_id"]'],
      'other'
    );
    
    // Then fill school name in text field
    await tryFillInput(
      ['input[name="school"]', 'input[placeholder*="school" i]', 'input[id*="school"]', 'input[name="school_name"]'],
      schoolValue
    );
    
    if (schoolValue) {
      await page.waitForTimeout(1500);
      // Click first autocomplete suggestion if it appears
      try {
        const suggestion = page.locator('li, [role="option"], [data-testid*="suggestion"]').first();
        if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
          await suggestion.click();
          console.log('✅ School autocomplete suggestion selected');
        }
      } catch (e) {}
    }
    console.log(`✅ School set to: ${schoolValue}`);

    // 5. What is your highest level of education? (dropdown)
    const educationLevel = profile.educationLevel || 'Bachelors';
    await trySelectDropdown(
      ['select[name="education"]', 'select[name="degree"]', 'select[id*="education"]', 'select[id*="degree"]', 'select[name="education_level"]'],
      educationLevel
    );
    console.log(`✅ Education level set to: ${educationLevel}`);

    // 6. When did you graduate? (dropdown - year)
    const gradYear = String(profile.gradYear || 2026);
    await trySelectDropdown(
      ['select[name="grad_year"]', 'select[name="graduation_year"]', 'select[id*="grad"]', 'select[name="year"]'],
      gradYear
    );
    console.log(`✅ Graduation year set to: ${gradYear}`);

    // 7. What's your LinkedIn URL? (text input)
    const linkedinFromProfile = profile.linkedinUrl || 'https://linkdin//ajithchandra93877474';
    await tryFillInput(
      ['input[name="linkedin"]', 'input[placeholder*="linkedin" i]', 'input[placeholder*="LinkedIn"]', 'input[name="linkedin_url"]'],
      linkedinFromProfile
    );
    console.log(`✅ LinkedIn URL set to: ${linkedinFromProfile}`);

    // 8. What country are you located in? (dropdown)
    const countryValue = profile.country || 'India';
    await trySelectDropdown(
      ['select[name="country"]', 'select[id*="country"]', 'select[name="location"]'],
      countryValue
    );
    console.log(`✅ Country set to: ${countryValue}`);

    // 9. How did you hear about us? (dropdown)
    const hearAboutUsValue = profile.heardAboutUs || 'Google';
    await trySelectDropdown(
      ['select[name="hear_about_us"]', 'select[name="source"]', 'select[id*="hear"]', 'select[name="referral_source"]'],
      hearAboutUsValue
    );
    console.log(`✅ "How did you hear about us" set to: ${hearAboutUsValue}`);

    // 10. Referral code (optional - text input)
    const referralCode = profile.referralCode || '';
    if (referralCode) {
      await tryFillInput(
        ['input[name="referral_code"]', 'input[placeholder*="referral" i]', 'input[name="code"]'],
        referralCode
      );
      console.log(`✅ Referral code set to: ${referralCode}`);
    } else {
      console.log('ℹ️  Referral code left blank (optional)');
    }

    // Wait for resume upload section
    console.log('⏳ Waiting for resume upload section...');
    await page.waitForTimeout(3000);
    
    // Check if resume upload field is present
    const fileInputSelectors = 'input[type="file"], [data-testid*="resume"], [name*="resume"]';
    const resumeUploadPresent = await page.locator(fileInputSelectors).count() > 0;
    
    if (resumeUploadPresent) {
      console.log('📄 Resume upload section detected. Waiting for manual resume upload...');
      console.log('⏳ Please upload your resume manually. The bot is actively monitoring for the file upload (5 minute timeout)...');
      
      // Wait for user to upload resume (actively monitor input.files.length)
      try {
        await page.waitForFunction(
          () => {
            const el = document.querySelector('input[type="file"]');
            return el && el.files && el.files.length > 0;
          },
          null,
          { timeout: 300000 }
        );
        console.log('✅ Resume upload detected! Proceeding to terms & conditions...');
        await page.waitForTimeout(2000); // Give it a brief moment after upload
      } catch (e) {
        console.log('⚠️ Resume upload wait timed out or failed. Attempting to proceed anyway...');
      }
    } else {
      console.log('ℹ️  No resume upload section detected. Proceeding to terms & conditions...');
    }

    // 11. Check "I agree to terms and conditions" checkbox (Wait for human to upload resume FIRST)
    console.log('⏳ Checking for terms and conditions checkbox...');
    await tryCheckCheckbox([
      'input[type="checkbox"][name*="terms"]',
      'input[type="checkbox"][name*="agree"]',
      'input[type="checkbox"][name*="conditions"]',
      'input[type="checkbox"][id*="terms"]',
      'input[type="checkbox"][id*="agree"]',
      'input[type="checkbox"]'
    ]);


    saveState(runId, 9, { 
      email, 
      firstName, 
      lastName, 
      linkedinUrl: linkedinFromProfile, 
      school: schoolValue,
      background: backgroundValue,
      subField: subFieldValue,
      currentRole: roleValue,
      educationLevel: educationLevel,
      graduationYear: gradYear,
      country: countryValue,
      hearAboutUs: hearAboutUsValue
    });

    console.log('✅ All onboarding fields filled automatically.');
    
    // STEP 10: Auto-submit the form
    console.log('STEP 10: Auto-submitting the onboarding form...');
    
    let finalSubmitClicked = false;
    const finalSubmitSelectors = [
      'button:has-text("Submit")',
      'button:has-text("Complete Profile")',
      'button:has-text("Create Account")',
      'button:has-text("Finish")',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button[type="submit"]'
    ];
    
    for (const btnSel of finalSubmitSelectors) {
      try {
        const btn = page.locator(btnSel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`✅ Clicking final submit button via: ${btnSel}`);
          await btn.click();
          finalSubmitClicked = true;
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {}
    }
    
    if (!finalSubmitClicked) {
      console.log('⚠️ Could not find standard submit button. Trying Enter key...');
      try {
        await page.keyboard.press('Enter');
        console.log('✅ Pressed Enter for final submission.');
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log('⚠️ Fallback submission failed.');
      }
    }
    
    // STEP 11: Final Navigation Verification
    console.log('STEP 11: Verifying successful submission and navigation...');
    try {
      // Wait for navigation away from onboarding or up to 15 seconds
      await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
      
      // Give the page time to settle
      await page.waitForTimeout(5000);
      
      const postSubmitUrl = page.url();
      console.log(`Current URL after submission: ${postSubmitUrl}`);
      
      if (postSubmitUrl.includes('app.joinhandshake.com/stu') || (!postSubmitUrl.includes('onboarding') && !postSubmitUrl.includes('access'))) {
         console.log('✅ Successfully navigated to dashboard or home page!');
      } else {
         console.log('⚠️ Still on an onboarding or unexpected URL. Checking for errors...');
         const errorText = await page.locator('.error, .alert-danger, [role="alert"]').first().textContent().catch(() => '');
         if (errorText) {
           console.log(`❌ Possible submission error: ${errorText}`);
         } else {
           console.log('⚠️ No visible errors found, but URL did not change as expected.');
         }
      }
    } catch (e) {
      console.log(`⚠️ Navigation verification issue: ${e.message}`);
    }

    console.log('STEP 10: Writing complete details to CSV...');
    const csvWriter = createObjectCsvWriter({
      path: 'captured_details.csv',
      header: [
        { id: 'runId', title: 'RUN_ID' },
        { id: 'email', title: 'EMAIL' },
        { id: 'firstName', title: 'FIRST_NAME' },
        { id: 'lastName', title: 'LAST_NAME' },
        { id: 'mobileNumber', title: 'MOBILE_NUMBER' },
        { id: 'linkedinUrl', title: 'LINKEDIN_URL' },
        { id: 'school', title: 'SCHOOL' },
        { id: 'background', title: 'BACKGROUND' },
        { id: 'subField', title: 'SUB_FIELD' },
        { id: 'currentRole', title: 'CURRENT_ROLE' },
        { id: 'educationLevel', title: 'EDUCATION_LEVEL' },
        { id: 'graduationYear', title: 'GRADUATION_YEAR' },
        { id: 'country', title: 'COUNTRY' },
        { id: 'hearAboutUs', title: 'HEAR_ABOUT_US' },
        { id: 'status', title: 'STATUS' },
        { id: 'timestamp', title: 'TIMESTAMP' },
      ],
      append: true,
    });

    await csvWriter.writeRecords([
      {
        runId: runId || 'N/A',
        email,
        firstName,
        lastName,
        mobileNumber,
        linkedinUrl: linkedinFromProfile,
        school: schoolValue,
        background: backgroundValue,
        subField: subFieldValue,
        currentRole: roleValue,
        educationLevel: educationLevel,
        graduationYear: gradYear,
        country: countryValue,
        hearAboutUs: hearAboutUsValue,
        status: 'SUCCESS',
        timestamp: new Date().toISOString(),
      },
    ]);
    console.log('✅ All complete details saved to captured_details.csv');
    
    // Clear state on successful completion
    clearState();

    console.log('✅ Onboarding automation completed. Form filled and waiting for human submission.');
  } catch (err) {
    console.error('Flow error:', err.message);
    // Save error state for recovery - use recovered data if available
    saveState(runId, -1, { 
      error: err.message, 
      email: email || '', 
      firstName: firstName || '', 
      lastName: lastName || '', 
      mobileNumber: mobileNumber || 'N/A', 
      linkedinUrl: linkedinFromProfile || linkedinUrl || 'N/A', 
      school: schoolValue || school || 'N/A',
      background: backgroundValue || '',
      subField: subFieldValue || '',
      currentRole: roleValue || '',
      educationLevel: educationLevel || '',
      graduationYear: gradYear || '',
      country: countryValue || '',
      hearAboutUs: hearAboutUsValue || ''
    });
    throw err;
  } finally {
    await safeExit(browser);
  }
}

module.exports = { runManualGuidedLogin };