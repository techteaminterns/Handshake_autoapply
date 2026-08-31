/**
 * test-full-flow.js
 *
 * Integrated end-to-end test runner for the full Handshake bot pipeline:
 * (1) Launches headless Chromium
 * (2) Navigates to real Handshake login
 * (3) Runs email signin + OTP via manualGuidedLogin.js
 * (4) Calls detectPageState():
 *     - If state = ONBOARDING: runs runOnboardingAutofill() to completion,
 *       waits for dashboard load, then redirects to mock site
 *     - If state = DASHBOARD (including URLs like /fellow/projects, /fellow/dashboard, /stu/):
 *       skips onboarding, immediately redirects to http://localhost:5173/mock-handshake/job/1
 * (5) Runs runApplyToJob() on the mock site
 * (6) Logs each step with status
 * (7) Calls safeExit(), exits code 0 on success, code 1 on failure
 */

const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { launchBrowser } = require('../src/browser/launch');
const { safeExit } = require('../src/safeExit');
const { runManualGuidedLogin, runOnboardingAutofill } = require('../src/flows/manualGuidedLogin');
const { detectPageState } = require('../src/flows/otpLogin');
const { runApplyToJob } = require('../src/flows/applyToJob');
const defaultProfile = require('../src/fixtures/profile');

const MOCK_JOB_URL = process.env.MOCK_HANDSHAKE_JOB_URL || 'http://localhost:5173/mock-handshake/job/1';
const HANDSHAKE_ACCESS_URL = process.env.HANDSHAKE_LOGIN_URL || 'https://app.joinhandshake.com/access?destination_hai_path=%2Fauth%3FredirectTo%3D%252Ffellow%252Fonboarding';

// Helper: Check if an HTTP URL is currently reachable
function checkServer(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.request(
        {
          host: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname || '/',
          method: 'GET',
          timeout: 2000,
        },
        (res) => resolve(res.statusCode >= 200 && res.statusCode < 500)
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

// Helper: Wait for server to become ready
async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const isUp = await checkServer(url);
    if (isUp) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  console.log('===============================================================');
  console.log('🚀 Starting Full Flow Test (Headless Handshake Auth -> Onboarding -> Mock Apply)');
  console.log('===============================================================\n');

  const runId = 'full-flow-run-' + Date.now();
  let browser = null;
  let serverProcess = null;

  try {
    // 0. Ensure Mock Handshake dev server is available for apply step
    console.log('[STEP 0/6] Checking Mock Handshake server availability...');
    const isServerRunning = await checkServer(MOCK_JOB_URL);
    if (!isServerRunning) {
      console.log(`ℹ️  Mock server not detected. Starting Vite dev server for mock-handshake...`);
      const mockHandshakeDir = path.resolve(__dirname, '../../mock-handshake');
      const isWindows = process.platform === 'win32';
      const npmCmd = isWindows ? 'npm.cmd' : 'npm';

      serverProcess = spawn(npmCmd, ['run', 'dev', '--', '--port', '5173'], {
        cwd: mockHandshakeDir,
        stdio: 'pipe',
        shell: true,
      });

      const ready = await waitForServer(MOCK_JOB_URL, 15000);
      if (!ready) {
        throw new Error(`Failed to start Mock Handshake server at ${MOCK_JOB_URL}`);
      }
      console.log('   ✓ Mock Handshake server is ready: [SUCCESS]\n');
    } else {
      console.log('   ✓ Mock Handshake server already active: [SUCCESS]\n');
    }

    // 1. Launch headless Chromium by default (or headful if HEADLESS=false)
    console.log('[STEP 1/6] Launching Chromium browser (default headless: true)...');
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    console.log('   ✓ Headless browser and context initialized: [SUCCESS]\n');

    // 2. Navigate to real Handshake login & 3. Run email signin + OTP verification
    console.log('[STEP 2 & 3/6] Navigating to Handshake login and executing Email + OTP signin...');
    const userData = await runManualGuidedLogin(runId, defaultProfile, page);
    console.log('   ✓ Signin and authentication steps completed: [SUCCESS]\n');

    // 4. Call detectPageState() after signin
    console.log('[STEP 4/6] Detecting post-login page state...');
    await page.waitForTimeout(3000);
    const state = await detectPageState(page, 10000);
    console.log(`   ✓ Page detection result: "${state}" [SUCCESS]\n`);

    if (state === 'ONBOARDING') {
      console.log('[STEP 4a/6] User is on Onboarding page. Running runOnboardingAutofill() to completion...');
      await runOnboardingAutofill(page, defaultProfile, runId, userData || {
        email: defaultProfile.studentEmail,
        firstName: defaultProfile.firstName,
        lastName: defaultProfile.lastName,
        mobileNumber: defaultProfile.phone || 'N/A'
      });
      console.log('   ✓ Onboarding autofill completed. Waiting for dashboard navigation...');
      await page.waitForTimeout(5000);
      console.log(`   ✓ Redirecting to Mock Handshake job page: ${MOCK_JOB_URL}...`);
      await page.goto(MOCK_JOB_URL, { waitUntil: 'networkidle' });
    } else {
      // DASHBOARD (including /fellow/projects, /fellow/dashboard, etc.) or non-onboarding state
      console.log(`[STEP 4b/6] User state is "${state}" (DASHBOARD / non-onboarding). Skipping onboarding, immediately redirecting to: ${MOCK_JOB_URL}...`);
      await page.goto(MOCK_JOB_URL, { waitUntil: 'networkidle' });
    }
    console.log('   ✓ Reached application target page: [SUCCESS]\n');

    // 5. Run runApplyToJob()
    console.log('[STEP 5/6] Executing runApplyToJob() on Mock Handshake page...');
    await runApplyToJob(MOCK_JOB_URL, defaultProfile.id || 'profile-id-1', runId, page);
    console.log('   ✓ Job application completed: [SUCCESS]\n');

    console.log('===============================================================');
    console.log('🎉 [STEP 6/6] FULL FLOW TEST COMPLETED SUCCESSFULLY! [STATUS: PASS]');
    console.log('===============================================================\n');
    process.exitCode = 0;
  } catch (err) {
    console.error('\n❌ [FULL FLOW ERROR]:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) {
      console.log('Closing browser session cleanly...');
      await safeExit(browser);
    }
    if (serverProcess) {
      console.log('Stopping background Vite dev server...');
      serverProcess.kill();
    }
  }
}

main();
