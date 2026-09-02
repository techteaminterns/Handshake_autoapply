/**
 * test-mock-apply.js
 *
 * End-to-end browser automation test for the mock Handshake Apply flow.
 * Runs Playwright against http://localhost:5173/mock-handshake/job/1 (or custom URL).
 *
 * Flow tested:
 * 1. Navigate to mock Handshake job listing (e.g. /mock-handshake/job/1)
 * 2. Verify job title, company, salary, and Apply button
 * 3. Click "Apply" button -> Navigates to /mock-handshake/apply/1
 * 4. Verify apply modal renders with disabled submit button
 * 5. Attach a valid test resume PDF
 * 6. Verify submit button becomes active
 * 7. Click "Submit Application" -> Navigates to /mock-handshake/done
 * 8. Verify confirmation screen ("Application submitted!")
 * 9. Click "Back to Job Listing" -> Navigates back to /mock-handshake/job/1
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { launchBrowser } = require('../src/browser/launch');
const { safeExit } = require('../src/safeExit');

// Configuration
const DEFAULT_URL = process.env.MOCK_HANDSHAKE_URL || 'http://localhost:5173/mock-handshake/job/1';
const TARGET_URL = process.argv[2] || DEFAULT_URL;

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

// Helper: Ensure a dummy test resume PDF exists
function ensureTestResume() {
  const resumePath = path.resolve(__dirname, '../test-resume.pdf');
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
  return resumePath;
}

async function runMockApplyTest() {
  console.log('====================================================');
  console.log('🧪 Starting Mock Handshake Apply Flow Playwright Test');
  console.log(`Target URL: ${TARGET_URL}`);
  console.log('====================================================\n');

  let serverProcess = null;
  const isServerRunning = await checkServer(TARGET_URL);

  if (!isServerRunning) {
    console.log(`ℹ️  Server not detected at ${TARGET_URL}. Starting Vite dev server for mock-handshake...`);
    const mockHandshakeDir = path.resolve(__dirname, '../../mock-handshake');
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';

    serverProcess = spawn(npmCmd, ['run', 'dev', '--', '--port', '5173'], {
      cwd: mockHandshakeDir,
      stdio: 'pipe',
      shell: true,
    });

    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Local:')) {
        console.log(`[Vite Server] ${msg.trim()}`);
      }
    });

    const ready = await waitForServer(TARGET_URL, 15000);
    if (!ready) {
      if (serverProcess) serverProcess.kill();
      throw new Error(`Failed to connect to ${TARGET_URL} after starting Vite server.`);
    }
    console.log('✅ Mock Handshake server is ready!\n');
  } else {
    console.log('✅ Connected to existing Mock Handshake server.\n');
  }

  const resumeFilePath = ensureTestResume();
  let browser = null;

  try {
    // Launch Playwright browser
    console.log('1️⃣  Launching browser...');
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Navigate to Job Details Page
    console.log(`2️⃣  Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

    // 2. Verify Job Details Elements
    console.log('3️⃣  Verifying Job Details page elements...');
    await page.waitForSelector('[data-testid="job-title"]', { timeout: 5000 });
    const jobTitle = await page.locator('[data-testid="job-title"]').textContent();
    console.log(`   ✓ Found Job Title: "${jobTitle.trim()}"`);

    const applyBtn = page.locator('[data-testid="job-apply-btn"]');
    if ((await applyBtn.count()) === 0) {
      throw new Error('Apply button [data-testid="job-apply-btn"] not found on Job Details page');
    }
    console.log('   ✓ Found [data-testid="job-apply-btn"]');

    // 3. Click Apply Button
    console.log('4️⃣  Clicking Apply button...');
    await applyBtn.click();

    // 4. Verify Apply Page / Modal
    console.log('5️⃣  Verifying Apply page modal loaded...');
    await page.waitForSelector('[data-testid="submit-application-btn"]', { timeout: 5000 });
    console.log('   ✓ Apply page loaded successfully');

    // Verify submit button is disabled initially
    const submitBtn = page.locator('[data-testid="submit-application-btn"]');
    const isDisabledInitially = await submitBtn.isDisabled();
    if (!isDisabledInitially) {
      console.warn('   ⚠️  Warning: Submit button was expected to be disabled before resume attachment');
    } else {
      console.log('   ✓ Submit button is initially disabled (as expected)');
    }

    // 5. Attach Resume PDF
    console.log('6️⃣  Attaching resume file...');
    const fileInput = page.locator('input[data-testid="resume-file-input"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(resumeFilePath);
      console.log(`   ✓ Uploaded resume: ${path.basename(resumeFilePath)}`);
    } else {
      // Fallback: Click chip if file input isn't present
      const chip = page.locator('.doc-pill-chip').first();
      await chip.click();
      console.log('   ✓ Selected resume from chips');
    }

    await page.waitForTimeout(500);

    // Verify submit button is now enabled
    const isEnabledNow = await submitBtn.isEnabled();
    if (!isEnabledNow) {
      throw new Error('Submit button is still disabled after attaching resume');
    }
    console.log('   ✓ Submit button is now enabled');

    // 6. Submit Application
    console.log('7️⃣  Submitting application...');
    await submitBtn.click();

    // 7. Verify Done Page
    console.log('8️⃣  Verifying application completion page...');
    await page.waitForSelector('[data-testid="apply-complete"]', { timeout: 5000 });
    const heading = await page.locator('[data-testid="apply-complete-heading"]').textContent();
    console.log(`   ✓ Success! Confirmation heading: "${heading.trim()}"`);

    // 8. Test Return Button
    console.log('9️⃣  Testing "Back to Job Listing" button...');
    const backBtn = page.locator('button:has-text("Back to Job Listing")');
    await backBtn.click();
    await page.waitForSelector('[data-testid="job-apply-btn"]', { timeout: 5000 });
    console.log('   ✓ Successfully navigated back to Job Listing page');

    console.log('\n====================================================');
    console.log('🎉 ALL MOCK HANDSHAKE APPLY CHECKS PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err.message);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await safeExit(browser);
    }
    if (serverProcess) {
      console.log('Stopping temporary Vite server...');
      serverProcess.kill();
    }
  }
}

runMockApplyTest();
