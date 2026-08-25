const { launchBrowser } = require('../src/browser/launch');

(async () => {
  console.log('Launching visible browser to inspect login form...');
  const browser = await launchBrowser(false); // non-headless
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to Handshake login...');
    await page.goto('https://app.joinhandshake.com/access');
    
    // Wait for page to load
    await page.waitForTimeout(5000);
    
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());
    
    // Get all input fields
    const inputs = await page.$$eval('input', inputs => 
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className,
        value: input.value
      }))
    );
    
    console.log('\n=== INPUT FIELDS ===');
    console.log(JSON.stringify(inputs, null, 2));
    
    // Get all buttons
    const buttons = await page.$$eval('button', buttons => 
      buttons.map(button => ({
        text: button.textContent.trim(),
        type: button.type,
        className: button.className,
        id: button.id
      }))
    );
    
    console.log('\n=== BUTTONS ===');
    console.log(JSON.stringify(buttons, null, 2));
    
    // Get all forms
    const forms = await page.$$eval('form', forms => 
      forms.map(form => ({
        action: form.action,
        method: form.method,
        className: form.className,
        id: form.id
      }))
    );
    
    console.log('\n=== FORMS ===');
    console.log(JSON.stringify(forms, null, 2));
    
    // Get text content to understand the page structure
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('\n=== PAGE TEXT (first 1500 chars) ===');
    console.log(bodyText.substring(0, 1500));
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-login-form.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-login-form.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
