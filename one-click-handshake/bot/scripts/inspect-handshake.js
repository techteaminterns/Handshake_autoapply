const { launchBrowser } = require('../src/browser/launch');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto('https://joinhandshake.com/login');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Get all input fields
    const inputs = await page.$$eval('input', inputs => 
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className
      }))
    );
    
    console.log('=== INPUT FIELDS ===');
    console.log(JSON.stringify(inputs, null, 2));
    
    // Get all buttons
    const buttons = await page.$$eval('button', buttons => 
      buttons.map(button => ({
        text: button.textContent.trim(),
        type: button.type,
        className: button.className
      }))
    );
    
    console.log('\n=== BUTTONS ===');
    console.log(JSON.stringify(buttons, null, 2));
    
    // Get form structure
    const forms = await page.$$eval('form', forms => 
      forms.map(form => ({
        action: form.action,
        method: form.method,
        className: form.className
      }))
    );
    
    console.log('\n=== FORMS ===');
    console.log(JSON.stringify(forms, null, 2));
    
    // Take screenshot for visual reference
    await page.screenshot({ path: 'handshake-login-inspect.png' });
    console.log('\nScreenshot saved: handshake-login-inspect.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
