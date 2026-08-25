const { launchBrowser } = require('../src/browser/launch');
const profile = require('../src/fixtures/profile');

(async () => {
  console.log('Testing OTP login flow step by step...');
  const browser = await launchBrowser(false); // non-headless to bypass Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Step 1: Navigate to login page');
    await page.goto('https://app.joinhandshake.com/access');
    await page.waitForTimeout(3000);
    console.log('Current URL:', page.url());
    
    console.log('Step 2: Fill email field');
    await page.fill('input[name="email"]', profile.studentEmail);
    console.log('Email filled');
    
    console.log('Step 3: Click continue button');
    await page.click('button:has-text("Continue with email")');
    console.log('Continue button clicked');
    
    console.log('Step 4: Wait for next page to load');
    await page.waitForTimeout(8000);
    console.log('Current URL after continue:', page.url());
    console.log('Page title:', await page.title());
    
    // Inspect what's on the next page
    const inputs = await page.$$eval('input', inputs => 
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className
      }))
    );
    
    console.log('\n=== INPUT FIELDS ON NEXT PAGE ===');
    console.log(JSON.stringify(inputs, null, 2));
    
    const buttons = await page.$$eval('button', buttons => 
      buttons.map(button => ({
        text: button.textContent.trim(),
        type: button.type,
        className: button.className
      }))
    );
    
    console.log('\n=== BUTTONS ON NEXT PAGE ===');
    console.log(JSON.stringify(buttons, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-otp-page.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-otp-page.png');
    
    console.log('Browser will stay open for 15 seconds for manual inspection...');
    await page.waitForTimeout(15000);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
