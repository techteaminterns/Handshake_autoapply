const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const {
  getResumeUrl,
  getReusableAnswer,
  pauseForLiveHandoff,
  checkAndIncrementActionCount,
  markRunStatus,
} = require('../stubs/sideA');

async function runApplyToJob(jobLink, profileId, runId) {
  const browser = await launchBrowser(false); // non-headless to bypass Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    const underCap = await checkAndIncrementActionCount(runId);
    if (!underCap) throw new Error('Daily action cap reached');

    // Step 1: Navigate to job page automatically
    await page.goto(jobLink);
    await page.waitForTimeout(3000);

    // Step 2: Auto-click Apply button (Quick Apply if available)
    const hasQuickApply = await page.locator('text=Quick Apply').count() > 0;
    if (hasQuickApply) {
      await page.click('text=Quick Apply');
    } else {
      await page.click('text=Apply');
    }
    await page.waitForTimeout(3000);

    // Step 3: PAUSE - Wait for human to handle document upload if needed
    await pauseForLiveHandoff(runId, 'document_upload');

    // Step 4: Auto-answer questions that have reusable answers
    const questions = await page.locator('.application-question').all();
    for (const q of questions) {
      const questionText = await q.textContent();
      const reusableAnswer = await getReusableAnswer(profileId, questionText);
      
      if (reusableAnswer) {
        // Auto-fill with reusable answer
        await q.locator('input, textarea').fill(reusableAnswer);
      } else {
        // Step 5: PAUSE - Wait for human to answer new questions
        await pauseForLiveHandoff(runId, 'question_answer');
      }
    }

    // Step 6: Auto-submit application
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
