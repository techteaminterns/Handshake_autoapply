const { chromium: playwright } = require('playwright-core');

async function launchBrowser(headlessOverride) {
  const headless = process.env.HEADLESS !== 'false' ? true : false;
  const isHeadless = typeof headlessOverride === 'boolean' && process.env.HEADLESS === undefined
    ? headlessOverride
    : headless;

  const browser = await playwright.launch({
    headless: isHeadless,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
  return browser;
}

module.exports = { launchBrowser };
