const { launchBrowser } = require('../src/browser/launch');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto('https://joinhandshake.com/login');
  await page.screenshot({ path: 'signup.png' });
  await browser.close();
  console.log('B0 checkpoint: screenshot saved.');
})();
