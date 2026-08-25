const { launchBrowser } = require('../src/browser/launch');
const profile = require('../src/fixtures/profile');

(async () => {
  console.log('Testing OTP button click...');
  const browser = await launchBrowser(false); // non-headless to bypass Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Step 1: Navigate to login page');
    await page.goto('https://app.joinhandshake.com/access');
    await page.waitForTimeout(3000);
    
    console.log('Step 2: Fill email field');
    await page.fill('input[name="email"]', profile.studentEmail);
    
    console.log('Step 3: Click continue button');
    await page.click('button:has-text("Continue with email")');
    
    console.log('Step 4: Wait for options page');
    await page.waitForTimeout(5000);
    console.log('Current URL:', page.url());
    
    console.log('Step 5: Click "Send one-time code" button');
    await page.click('button:has-text("Send one-time code")');
    
    console.log('Step 6: Wait for OTP input page');
    await page.waitForTimeout(8000);
    console.log('Current URL after OTP request:', page.url());
    
    // Inspect OTP input fields
    const inputs = await page.$$eval('input', inputs => 
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className
      }))
    );
    
    console.log('\n=== INPUT FIELDS ON OTP PAGE ===');
    console.log(JSON.stringify(inputs, null, 2));
    
    const buttons = await page.$$eval('button', buttons => 
      buttons.map(button => ({
        text: button.textContent.trim(),
        type: button.type,
        className: button.className
      }))
    );
    
    console.log('\n=== BUTTONS ON OTP PAGE ===');
    console.log(JSON.stringify(buttons, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-otp-input-page.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-otp-input-page.png');
    
    console.log('Browser will stay open for 15 seconds...');
    await page.waitForTimeout(15000);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
