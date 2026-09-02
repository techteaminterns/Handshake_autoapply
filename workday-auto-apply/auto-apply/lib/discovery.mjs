/**
 * discovery.mjs — Portal-aware form discovery
 *
 * Detects ATS platform (Greenhouse, Lever, Ashby, Workday, Gem, generic)
 * and navigates from JD page to the actual application form.
 */

// ─── ATS Detection ─────────────────────────────────────────────────────────
export function detectATS(url) {
  if (/greenhouse\.io/i.test(url)) return 'greenhouse';
  if (/lever\.co/i.test(url)) return 'lever';
  if (/ashbyhq\.com/i.test(url)) return 'ashby';
  if (/myworkday|workday/i.test(url)) return 'workday';
  if (/jobs\.gem\.com/i.test(url)) return 'gem';
  if (/icims/i.test(url)) return 'icims';
  if (/smartrecruiters/i.test(url)) return 'smartrecruiters';
  return 'generic';
}

// ─── Portal-aware form discovery ────────────────────────────────────────────
// Each ATS has different patterns for getting from JD page to form.
export async function discoverApplicationForm(page, originalUrl) {
  const currentUrl = page.url();

  // Strategy 1: Greenhouse — check for #app anchor or embedded form
  if (currentUrl.includes('greenhouse.io')) {
    if (!currentUrl.includes('#app')) {
      console.log('🌿 Greenhouse detected — looking for application form...');

      const hasJobContent = await page.$('.job-post, #job_post, .opening, [data-mapped="true"], #app_body');
      if (!hasJobContent) {
        const jobLink = await page.$(`a[href*="${originalUrl.split('/').pop()}"]`);
        if (jobLink) {
          console.log('  📎 Clicking through to specific job...');
          await jobLink.click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(2000);
        }
      }

      const applySelectors = [
        'a:has-text("Apply for this job")',
        'a:has-text("Apply")',
        'button:has-text("Apply for this job")',
        'button:has-text("Apply")',
        'a[href*="#app"]',
        '#apply_button',
        '.apply-button',
        'a.postings-btn',
      ];

      for (const sel of applySelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            const text = await btn.textContent();
            console.log(`  📎 Found: "${text.trim()}" — clicking...`);
            await btn.click();
            await page.waitForTimeout(2000);
            try {
              await page.waitForSelector('input[type="text"], input[type="email"], textarea', { timeout: 5000 });
            } catch { /* form might be further down */ }
            break;
          }
        } catch { /* selector not found, try next */ }
      }

      await page.evaluate(() => {
        const appSection = document.getElementById('application') || document.getElementById('app_body') || document.getElementById('app');
        if (appSection) appSection.scrollIntoView({ behavior: 'instant' });
        else window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(1000);
    }
    return page.url();
  }

  // Strategy 2: Lever — forms are on /apply/ path
  if (currentUrl.includes('lever.co') && !currentUrl.includes('/apply')) {
    console.log('🔧 Lever detected — looking for application form...');
    const applyLink = await page.$('a[href*="/apply"], a.postings-btn:has-text("Apply")');
    if (applyLink) {
      const href = await applyLink.getAttribute('href');
      if (href) {
        const resolvedHref = new URL(href, currentUrl).toString();
        console.log(`  📎 Navigating to Lever form: ${resolvedHref}`);
        await page.goto(resolvedHref, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        return page.url();
      }
    }
  }

  // Strategy 3: Ashby — forms are embedded or on /application path
  if (currentUrl.includes('ashbyhq.com') && !currentUrl.includes('/application')) {
    console.log('🏗️  Ashby detected — looking for application form...');
    const applyBtn = await page.$('button:has-text("Apply"), a:has-text("Apply")');
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
      try {
        await page.waitForSelector('input[type="text"], input[type="email"]', { timeout: 5000 });
      } catch { /* form might load differently */ }
      return page.url();
    }
  }

  // Strategy 4: Workday — JD page to Apply / Login / Form
  if (currentUrl.includes('workday') || currentUrl.includes('myworkday')) {
    console.log('📋 Workday detected — navigating to application form...');

    // Accept cookie notice if present
    try {
      const cookieBtn = await page.$('button[data-automation-id="legalNoticeAcceptButton"], button:has-text("Accept Cookies"), button:has-text("Accept all"), button:has-text("Accept")');
      if (cookieBtn && await cookieBtn.isVisible().catch(() => false)) {
        console.log('   Dismissing cookie banner...');
        await cookieBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch {}

    // Check if already on form or sign-in
    const isAlreadyOnForm = await page.$('input[data-automation-id="email"], input[data-automation-id="userName"], input[data-automation-id="legalNameSection_firstName"], input[name*="legalName"], input[id*="legalName"]');
    if (isAlreadyOnForm || currentUrl.includes('/apply/')) {
      console.log('   Already on Workday form / sign-in page.');
      return page.url();
    }

    // Target initial Apply button
    const workdayApplySelectors = [
      'a[data-automation-id="adventureButton"]',
      'a[data-automation-id="applyButton"]',
      'button[data-automation-id="applyButton"]',
      '[data-automation-id="jobPostingApplyButton"]',
      'a[data-automation-id*="apply" i]',
      'button[data-automation-id*="apply" i]',
      'a[data-uxi-element-id*="apply"]',
      'button[data-uxi-element-id*="apply"]',
      'a:has-text("Apply for this job")',
      'button:has-text("Apply for this job")',
      'a:has-text("Apply Now")',
      'button:has-text("Apply Now")',
      'a:has-text("Apply")',
      'button:has-text("Apply")',
    ];

    let applyBtn = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (const sel of workdayApplySelectors) {
        try {
          const btn = await page.$(sel);
          if (btn && await btn.isVisible().catch(() => false)) {
            applyBtn = btn;
            break;
          }
        } catch {}
      }
      if (applyBtn) break;
      await page.waitForTimeout(1500);
    }

    if (applyBtn) {
      const text = (await applyBtn.textContent().catch(() => '')).trim();
      console.log(`   Found initial Workday Apply button: "${text || 'Apply'}" — clicking...`);
      await applyBtn.click({ force: true }).catch(() => applyBtn.evaluate(el => el.click()));
      await page.waitForTimeout(2000);

      // Check for popup choices ("Apply Manually", "Autofill with Resume")
      const manualApplySelectors = [
        'a[data-automation-id="applyManually"]',
        'button[data-automation-id="applyManually"]',
        'a:has-text("Apply Manually")',
        'button:has-text("Apply Manually")',
        'a[href*="applyManually"]',
        'a[data-automation-id="autofillWithResume"]',
        'button[data-automation-id="autofillWithResume"]',
        'a:has-text("Autofill with Resume")',
      ];

      for (const sel of manualApplySelectors) {
        try {
          const opt = await page.$(sel);
          if (opt && await opt.isVisible().catch(() => false)) {
            const optText = (await opt.textContent().catch(() => '')).trim();
            console.log(`   Selecting Workday apply option: "${optText}"...`);
            await opt.click({ force: true }).catch(() => opt.evaluate(el => el.click()));
            await page.waitForTimeout(2000);
            break;
          }
        } catch {}
      }

      try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
      await page.waitForTimeout(2500);
      return page.url();
    }

    return page.url();
  }

  // Strategy 5: Gem — direct application pages
  if (currentUrl.includes('jobs.gem.com')) {
    console.log('💎 Gem detected — looking for application form...');
    const applyBtn = await page.$('button:has-text("Apply"), a:has-text("Apply")');
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
      try {
        await page.waitForSelector('input[type="text"], input[type="email"]', { timeout: 5000 });
      } catch {}
      return page.url();
    }
  }

  // Strategy 6: Generic — look for any Apply link/button and follow it
  const genericApply = await page.$([
    'a:has-text("Apply for this job")',
    'a:has-text("Apply Now")',
    'a:has-text("Apply")',
    'button:has-text("Apply for this job")',
    'button:has-text("Apply Now")',
  ].join(', '));

  if (genericApply) {
    const tagName = await genericApply.evaluate(el => el.tagName.toLowerCase());
    const text = await genericApply.textContent();

    if (tagName === 'a') {
      const href = await genericApply.getAttribute('href');
      if (href && !href.startsWith('javascript') && !href.startsWith('#')) {
        const resolvedHref = new URL(href, currentUrl).toString();
        console.log(`  📎 Generic apply link: "${text.trim()}" → ${resolvedHref}`);
        await page.goto(resolvedHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
        try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
        await page.waitForTimeout(2000);
        return page.url();
      }
    }

    console.log(`  📎 Clicking: "${text.trim()}"...`);
    await genericApply.click();
    await page.waitForTimeout(2000);
    return page.url();
  }

  return null;
}

// ─── Extract JD text from page (for resume matching) ────────────────────────
export async function extractJDText(page) {
  return page.evaluate(() => {
    const selectors = [
      '.job-post-content', '.job-description', '.posting-description',
      '#job-description', '.description', '[class*="jobDescription"]',
      '[class*="job-details"]', 'article', 'main',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) return el.textContent.trim();
    }
    return document.body?.innerText?.substring(0, 5000) || '';
  });
}
