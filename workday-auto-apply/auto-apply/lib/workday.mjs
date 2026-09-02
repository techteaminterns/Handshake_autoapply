/**
 * workday.mjs — Workday account creation & login
 *
 * Workday requires an account to apply. This module:
 * 1. Detects Workday login page
 * 2. Creates account (or logs in if credentials exist)
 * 3. Fills email + auto-generates password
 * 4. Handles email verification for account
 * 5. Navigates to the application form
 */

import { fetchOTPFromGmail } from './otp.mjs';
import { discoverApplicationForm } from './discovery.mjs';

// ─── Generate a secure password ─────────────────────────────────────────────
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const specials = '!@#$%&*';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  // Add a special char and digit to satisfy most policies
  pwd += specials[Math.floor(Math.random() * specials.length)];
  pwd += Math.floor(Math.random() * 10);
  return pwd;
}

// ─── Detect if page is Workday login ────────────────────────────────────────
export async function isWorkdayLogin(page) {
  const url = page.url();
  if (!/workday|myworkday/i.test(url)) return false;

  // If application form fields are already present, we are past login
  const hasAppFields = await page.$('input[data-automation-id="legalNameSection_firstName"], input[name*="legalName"], input[id*="legalName"], input[id*="address--"], [data-automation-id="phone-number"], [data-automation-id="file-upload-input-drop-zone"]');
  if (hasAppFields) return false;

  const hasLogin = await page.$([
    'input[data-automation-id="email"]',
    'input[data-automation-id="userName"]',
    'input[data-automation-id="password"]',
    'input[data-automation-id="verifyPassword"]',
    'button[data-automation-id="signInLink"]',
    'button[data-automation-id="createAccountSubmitButton"]',
    'button[data-automation-id="signInSubmitButton"]',
    'button[data-automation-id="createAccountLink"]',
  ].join(', '));

  return !!hasLogin;
}

// ─── Login to Workday ───────────────────────────────────────────────────────
export async function workdayLogin(page, email, password) {
  console.log('   Logging into Workday...');

  // Switch to Sign In tab if currently on Create Account tab
  try {
    const createAccountSubmit = await page.$('button[data-automation-id="createAccountSubmitButton"]');
    if (createAccountSubmit && await createAccountSubmit.isVisible().catch(() => false)) {
      const signInTab = await page.$('button[data-automation-id="signInLink"], button:has-text("Sign In"), a:has-text("Sign In")');
      if (signInTab && await signInTab.isVisible().catch(() => false)) {
        console.log('    Switching to Workday Sign In tab...');
        await signInTab.click({ force: true }).catch(() => signInTab.evaluate(el => el.click()));
        await page.waitForTimeout(1500);
      }
    }
  } catch {}

  // Fill visible email
  const emailInputs = await page.$$('input[data-automation-id="email"], input[data-automation-id="userName"], input[type="email"]');
  for (const inp of emailInputs) {
    if (await inp.isVisible().catch(() => false)) {
      await inp.fill(email);
      await page.waitForTimeout(200);
      break;
    }
  }

  // Fill visible password
  const passwordInputs = await page.$$('input[data-automation-id="password"], input[type="password"]');
  for (const inp of passwordInputs) {
    if (await inp.isVisible().catch(() => false)) {
      await inp.fill(password);
      await page.waitForTimeout(200);
      break;
    }
  }

  // Click visible Sign In button with force: true
  const signInButtons = await page.$$('button[data-automation-id="signInSubmitButton"], button:has-text("Sign In"), button[type="submit"]');
  for (const btn of signInButtons) {
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => btn.evaluate(el => el.click()));
      break;
    }
  }

  await page.waitForTimeout(4000);
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await page.waitForTimeout(2000);

  const stillHasPasswordInput = await page.$('input[type="password"]:visible, input[data-automation-id="password"]:visible').catch(() => null);
  const stillOnLogin = stillHasPasswordInput || await page.$('.error-message, [data-automation-id*="error"]').catch(() => null);

  if (stillOnLogin) {
    console.log('    Workday login with existing credentials failed or account does not exist.');
    return false;
  }

  console.log('   Workday login successful.');
  return true;
}

// ─── Create Workday account ─────────────────────────────────────────────────
export async function workdayCreateAccount(page, email, otpEmail, otpPassword, givenPassword) {
  console.log('   Creating Workday account...');

  try {
    const signInSubmit = await page.$('button[data-automation-id="signInSubmitButton"]');
    if (signInSubmit && await signInSubmit.isVisible().catch(() => false)) {
      const createTab = await page.$('button[data-automation-id="createAccountLink"], button:has-text("Create Account"), a:has-text("Create Account")');
      if (createTab && await createTab.isVisible().catch(() => false)) {
        await createTab.click({ force: true }).catch(() => createTab.evaluate(el => el.click()));
        await page.waitForTimeout(1500);
      }
    }
  } catch {}

  const emailInputs = await page.$$('input[data-automation-id="email"], input[type="email"], input[name="email"]');
  for (const inp of emailInputs) {
    if (await inp.isVisible().catch(() => false)) {
      await inp.fill(email);
      break;
    }
  }

  const password = givenPassword || generatePassword();
  const pwdInput = await page.$('input[data-automation-id="password"], input[type="password"]');
  if (pwdInput && await pwdInput.isVisible().catch(() => false)) await pwdInput.fill(password);

  const verifyPwdInput = await page.$('input[data-automation-id="verifyPassword"]');
  if (verifyPwdInput && await verifyPwdInput.isVisible().catch(() => false)) await verifyPwdInput.fill(password);

  const termsCheckbox = await page.$('input[type="checkbox"][data-automation-id*="createAccountCheckbox"], input[type="checkbox"][data-automation-id*="agree"], input[type="checkbox"][name*="agree"], label:has-text("agree") input[type="checkbox"]');
  if (termsCheckbox) {
    const isChecked = await termsCheckbox.isChecked().catch(() => false);
    if (!isChecked) await termsCheckbox.click({ force: true }).catch(() => termsCheckbox.evaluate(el => el.click()));
  }

  const submitBtn = await page.$('button[data-automation-id="createAccountSubmitButton"], button[type="submit"], button:has-text("Create Account"), button:has-text("Sign Up")');
  if (submitBtn) {
    await submitBtn.click({ force: true }).catch(() => submitBtn.evaluate(el => el.click()));
    await page.waitForTimeout(5000);
    try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  }

  // Check for email verification
  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  if (/verif|confirm|code|check your email/i.test(bodyText)) {
    console.log('   Email verification required for account...');

    if (otpEmail && otpPassword) {
      const submitTime = Date.now() - 10000;
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const code = await fetchOTPFromGmail(otpEmail, otpPassword, 3, submitTime);
        if (code) {
          console.log(`   Verification code: ${code}`);
          const codeInput = await page.$('input[name*="code"], input[name*="verification"], input[placeholder*="code"]');
          if (codeInput) {
            await codeInput.fill(code);
            const verifyBtn = await page.$('button:has-text("Verify"), button:has-text("Confirm"), button[type="submit"]');
            if (verifyBtn) {
              await verifyBtn.click({ force: true }).catch(() => verifyBtn.evaluate(el => el.click()));
              await page.waitForTimeout(3000);
            }
          }
          break;
        }
        console.log(`     Waiting for verification email... (${(i + 1) * 5}s)`);
      }
    } else {
      console.log('   No email credentials provided for verification.');
    }
  }

  return password;
}

// ─── Full Workday flow ──────────────────────────────────────────────────────
export async function handleWorkday(page, { email, password, otpEmail, otpPassword } = {}) {
  if (!await isWorkdayLogin(page)) {
    await discoverApplicationForm(page, page.url());
  }

  if (!await isWorkdayLogin(page)) return true;

  if (email && password) {
    const loggedIn = await workdayLogin(page, email, password);
    if (loggedIn) return true;
  }

  if (email) {
    const newPassword = await workdayCreateAccount(page, email, otpEmail, otpPassword, password);
    if (newPassword) {
      await page.waitForTimeout(3000);
      try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}

      if (await isWorkdayLogin(page)) {
        await workdayLogin(page, email, newPassword);
      }
      return true;
    }
  }

  console.log('   Cannot proceed with Workday — no credentials.');
  return false;
}
