const { chromium: playwright } = require('playwright-core');

async function launchBrowser(headless = true) {
  const browser = await playwright.launch({
    headless: headless,
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
