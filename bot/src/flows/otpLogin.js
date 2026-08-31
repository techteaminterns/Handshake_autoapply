const path = require('path');
const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const { pauseForLiveHandoff, markRunStatus } = require('../stubs/sideA');
const { runOnboardingAutofill } = require('./manualGuidedLogin');
const { runApplyToJob } = require('./applyToJob');

/**
 * detectPageState(page, timeoutMs = 10000)
 *
 * Checks URL patterns and DOM markers to determine the post-auth state:
 * - 'ONBOARDING': user has not completed onboarding
 * - 'DASHBOARD': user has already completed onboarding
 * - 'AUTH_ERROR': invalid OTP or authentication challenge error
 * - 'UNKNOWN': state could not be determined within timeout
 *
 * @param {import('playwright-core').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<'ONBOARDING'|'DASHBOARD'|'AUTH_ERROR'|'UNKNOWN'>}
 */
async function detectPageState(page, timeoutMs = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const url = page.url();

    // 1. Check URL patterns
    if (/onboarding|first_timers|welcome|edu_experiences/i.test(url)) {
      console.log(`[detectPageState] Match: ONBOARDING via URL "${url}"`);
      return 'ONBOARDING';
    }
    if (
      /joinhandshake\.com\/(stu|jobs|postings|feed|dashboard|fellow|projects)|localhost.*\/job\//i.test(url) ||
      url.includes('/fellow/projects') ||
      url.includes('/fellow/dashboard') ||
      url.includes('/fellow/') ||
      url.includes('/stu/')
    ) {
      console.log(`[detectPageState] Match: DASHBOARD via URL "${url}"`);
      return 'DASHBOARD';
    }

    // 2. Check DOM markers (if URL is still generic or transitioning)
    try {
      const hasOnboardingMarker = (await page.locator(
        'input[data-testid="resume-field-file-input"], [data-testid="expertise-step-next"], [data-testid="profile-first-name"], form[action*="onboarding"]'
      ).count()) > 0;
      if (hasOnboardingMarker) {
        console.log('[detectPageState] Match: ONBOARDING via DOM marker');
        return 'ONBOARDING';
      }

      const hasDashboardMarker = (await page.locator(
        'nav[aria-label="Main Navigation"], [data-hook="global-nav"], a[href*="/stu/jobs"], a[href*="/stu/postings"], [data-testid="job-apply-btn"], [data-testid="nav-bar"]'
      ).count()) > 0;
      if (hasDashboardMarker) {
        console.log('[detectPageState] Match: DASHBOARD via DOM marker');
        return 'DASHBOARD';
      }

      // 3. Check for Auth Error / Invalid OTP
      const hasAuthError = (await page.locator(
        '.error-message, [role="alert"]:has-text("invalid"), [role="alert"]:has-text("incorrect"), :text("Invalid code"), :text("Incorrect code")'
      ).count()) > 0;
      if (hasAuthError) {
        console.log('[detectPageState] Match: AUTH_ERROR via DOM error alert');
        return 'AUTH_ERROR';
      }
    } catch {
      // transient evaluation error during navigation
    }

    await page.waitForTimeout(500);
  }

  return 'UNKNOWN';
}

async function runOtpLogin(profile, runId) {
  const mockHandshakeJobUrl = process.env.MOCK_HANDSHAKE_JOB_URL || 'http://localhost:5173/mock-handshake/job/1';
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to login page automatically
    await page.goto(process.env.HANDSHAKE_LOGIN_URL || 'https://app.joinhandshake.com/access');
    await page.waitForTimeout(3000);
    
    // Step 2: PAUSE - Wait for human to enter email
    await pauseForLiveHandoff(runId, 'email_entry');
    
    // For testing: Fill test email since human didn't actually enter one
    await page.fill('input[name="email"]', profile.studentEmail);
    await page.waitForTimeout(2000);
    
    // Step 3: Auto-click continue button
    await page.click('button:has-text("Continue with email")');
    await page.waitForTimeout(5000);
    
    // Step 4: Auto-click "Send one-time code" button
    await page.click('button:has-text("Send one-time code")');
    await page.waitForTimeout(5000);
    
    // Step 5: PAUSE - Wait for human to enter OTP from email
    await pauseForLiveHandoff(runId, 'otp_entry');
    
    // For testing: Fill a test OTP since human didn't actually enter one
    await page.fill('input[name="passcode"]', '123456');
    await page.waitForTimeout(2000);
    
    // Step 6: Auto-click verify button
    await page.click('button:has-text("Verify")');
    await page.waitForTimeout(3000);

    // Step 7: Detect post-auth user page state
    console.log('🔍 Detecting page state after OTP verification...');
    const pageState = await detectPageState(page, 10000);
    console.log(`🧭 Detected user page state: ${pageState}`);

    if (pageState === 'ONBOARDING') {
      console.log('📋 Running onboarding autofill routine...');
      await runOnboardingAutofill(page, profile, runId, {
        email: profile.studentEmail,
        firstName: profile.firstName,
        lastName: profile.lastName,
        mobileNumber: profile.phone || 'N/A'
      });
      console.log(`🌐 Navigating to Mock Handshake: ${mockHandshakeJobUrl}`);
      await page.goto(mockHandshakeJobUrl, { waitUntil: 'networkidle' });
      await runApplyToJob(mockHandshakeJobUrl, profile.id || 'profile-id-1', runId, page);
    } else if (pageState === 'DASHBOARD') {
      console.log(`🌐 Dashboard detected. Immediately navigating to Mock Handshake: ${mockHandshakeJobUrl}`);
      await page.goto(mockHandshakeJobUrl, { waitUntil: 'networkidle' });
      await runApplyToJob(mockHandshakeJobUrl, profile.id || 'profile-id-1', runId, page);
    } else if (pageState === 'AUTH_ERROR' || pageState === 'UNKNOWN') {
      const screenshotPath = path.resolve(process.cwd(), 'auth-detection-failure.png');
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      console.error(`❌ Authentication failure or unresolved page state: ${pageState}. Diagnostic screenshot saved to ${screenshotPath}`);
      await markRunStatus(runId, 'failed', `Auth error or unknown page state: ${pageState}`);
      throw new Error(`Auth verification failed with state: ${pageState}`);
    }
    
    await markRunStatus(runId, 'succeeded');
  } catch (err) {
    await markRunStatus(runId, 'failed', err.message);
    throw err;
  } finally {
    await safeExit(browser);
  }
}

module.exports = { runOtpLogin, detectPageState };
