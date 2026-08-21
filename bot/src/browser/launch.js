const { chromium: playwright } = require('playwright-core');

async function launchBrowser() {
  const browser = await playwright.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-setuid-sandbox',
      '--no-sandbox',
    ],
  });
  return browser;
}

module.exports = { launchBrowser };
