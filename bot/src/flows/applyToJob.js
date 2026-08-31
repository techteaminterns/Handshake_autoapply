const { launchBrowser } = require('../browser/launch');
const { safeExit } = require('../safeExit');
const {
  getResumeUrl,
  getReusableAnswer,
  pauseForLiveHandoff,
  checkAndIncrementActionCount,
  markRunStatus,
} = require('../stubs/sideA');

async function runApplyToJob(jobLink, profileId, runId, existingPage = null) {
  let browser = null;
  let page = existingPage;

  if (!page) {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page = await context.newPage();
  }

  try {
    const underCap = await checkAndIncrementActionCount(runId);
    if (!underCap) throw new Error('Daily action cap reached');

    // Step 1: Navigate to job page automatically
    console.log(`[applyToJob] Navigating to ${jobLink}...`);
    await page.goto(jobLink, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Step 2: Auto-click Apply button (Quick Apply or Mock Apply if available)
    const mockApplyBtn = page.locator('[data-testid="job-apply-btn"]');
    const hasQuickApply = (await page.locator('text=Quick Apply').count()) > 0;

    if ((await mockApplyBtn.count()) > 0) {
      console.log('[applyToJob] Found [data-testid="job-apply-btn"], clicking...');
      await mockApplyBtn.click();
    } else if (hasQuickApply) {
      console.log('[applyToJob] Found "Quick Apply", clicking...');
      await page.click('text=Quick Apply');
    } else {
      console.log('[applyToJob] Clicking standard Apply button...');
      await page.click('text=Apply, button:has-text("Apply")');
    }
    await page.waitForTimeout(2000);

    // Step 3: Handle document upload if present
    const mockFileInput = page.locator('input[data-testid="resume-file-input"]');
    if ((await mockFileInput.count()) > 0) {
      console.log('[applyToJob] Mock resume input detected, attaching resume...');
      const path = require('path');
      const fs = require('fs');
      const resumePath = path.resolve(__dirname, '../../test-resume.pdf');
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
      await mockFileInput.setInputFiles(resumePath);
      await page.waitForTimeout(1000);
    } else {
      // Pause for human / live handoff if required
      await pauseForLiveHandoff(runId, 'document_upload');
    }

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
    const mockSubmitBtn = page.locator('[data-testid="submit-application-btn"]');
    if ((await mockSubmitBtn.count()) > 0) {
      console.log('[applyToJob] Clicking [data-testid="submit-application-btn"]...');
      await mockSubmitBtn.click();
      await page.waitForSelector('[data-testid="apply-complete"]', { timeout: 5000 }).catch(() => {});
    } else {
      console.log('[applyToJob] Submitting standard application form...');
      await page.click('button[type="submit"]');
    }
    
    console.log('✅ Application submitted successfully');
    await markRunStatus(runId, 'succeeded');
  } catch (err) {
    console.error('[applyToJob] Failed:', err.message);
    await markRunStatus(runId, 'failed', err.message);
    throw err;
  } finally {
    if (browser) {
      await safeExit(browser);
    }
  }
}

module.exports = { runApplyToJob };
