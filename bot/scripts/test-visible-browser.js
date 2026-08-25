const { launchBrowser } = require('../src/browser/launch');

(async () => {
  console.log('Launching visible browser to bypass Cloudflare...');
  const browser = await launchBrowser(false); // non-headless
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to Handshake login...');
    await page.goto('https://app.joinhandshake.com/access');
    
    // Wait for user to manually bypass Cloudflare if needed
    console.log('Waiting for page to load (you may need to complete Cloudflare challenge manually)...');
    await page.waitForTimeout(10000);
    
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-visible-browser.png', fullPage: true });
    console.log('Screenshot saved: handshake-visible-browser.png');
    
    console.log('Browser will stay open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
