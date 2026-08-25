const { launchBrowser } = require('../src/browser/launch');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    console.log('Navigating to real Handshake login...');
    await page.goto('https://app.joinhandshake.com/access');
    
    // Wait a bit for page to render
    await page.waitForTimeout(5000);
    
    // Get page info
    console.log('=== PAGE INFO ===');
    console.log('Title:', await page.title());
    console.log('URL:', page.url());
    
    // Get page text to understand what's there
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('\n=== PAGE TEXT (first 1000 chars) ===');
    console.log(bodyText.substring(0, 1000));
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-login-simple.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-login-simple.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
