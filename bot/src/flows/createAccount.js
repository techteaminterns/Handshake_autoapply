const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const { pauseForLiveHandoff, markRunStatus } = require('../stubs/sideA');

async function runCreateAccount(profile, runId) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto('https://joinhandshake.com/register');

    // --- fill signup fields from profile (selectors are placeholders —
    // you'll inspect real Handshake DOM and swap these) ---
    await page.fill('input[name="first_name"]', profile.firstName);
    await page.fill('input[name="last_name"]', profile.lastName);
    await page.fill('input[name="email"]', profile.studentEmail);
    await page.click('button[type="submit"]');

    // network-connections prompt → always "Maybe later"
    await page.click('text=Maybe later');

    // pause here — this is the live-handoff point (email verification)
    await pauseForLiveHandoff(runId, 'email_verification');

    // --- after resume: finish remaining onboarding screens ---
    // (placeholder — fill in once you see real post-verification screens)

    await markRunStatus(runId, 'succeeded');
  } catch (err) {
    await markRunStatus(runId, 'failed', err.message);
    throw err;
  } finally {
    await safeExit(browser);
  }
}

module.exports = { runCreateAccount };
