const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const { readOtpFromGmail, markRunStatus } = require('../stubs/sideA');

async function runOtpLogin(profile, runId) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto('https://joinhandshake.com/login');
    await page.fill('input[name="email"]', profile.studentEmail);
    await page.click('button[type="submit"]'); // triggers OTP email

    const otp = await readOtpFromGmail(profile.studentEmail);
    await page.fill('input[name="otp"]', otp);
    await page.click('button[type="submit"]');

    await markRunStatus(runId, 'succeeded');
  } catch (err) {
    await markRunStatus(runId, 'failed', err.message);
    throw err;
  } finally {
    await safeExit(browser);
  }
}

module.exports = { runOtpLogin };
