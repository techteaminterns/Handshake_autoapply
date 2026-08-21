const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const {
  getResumeUrl,
  getReusableAnswer,
  pauseAndRequestAnswer,
  checkAndIncrementActionCount,
  markRunStatus,
} = require('../stubs/sideA');

async function runApplyToJob(jobLink, profileId, runId) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    const underCap = await checkAndIncrementActionCount(runId);
    if (!underCap) throw new Error('Daily action cap reached');

    await page.goto(jobLink);

    // Quick Apply always wins if both present
    const hasQuickApply = await page.locator('text=Quick Apply').count() > 0;
    if (hasQuickApply) {
      await page.click('text=Quick Apply');
    } else {
      await page.click('text=Apply');
    }

    // document selection — always "Upload new," never a dropdown pick
    await page.click('text=Upload new');
    const resumeUrl = await getResumeUrl(profileId);
    // real upload uses page.setInputFiles with a downloaded local path;
    // placeholder here since resumeUrl needs to become a local file first

    // per-question loop (placeholder selector logic)
    const questions = await page.locator('.application-question').all();
    for (const q of questions) {
      const questionText = await q.textContent();
      let answer = await getReusableAnswer(profileId, questionText);
      if (!answer) {
        answer = await pauseAndRequestAnswer(profileId, questionText);
      }
      await q.locator('input, textarea').fill(answer);
    }

    await page.click('button[type="submit"]');
    await markRunStatus(runId, 'succeeded');
  } catch (err) {
    await markRunStatus(runId, 'failed', err.message);
    throw err;
  } finally {
    await safeExit(browser);
  }
}

module.exports = { runApplyToJob };
