const { launchBrowser } = require('../src/browser/launch');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    console.log('Navigating to real Handshake login...');
    await page.goto('https://app.joinhandshake.com/access');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Get page info
    console.log('=== PAGE INFO ===');
    console.log('Title:', await page.title());
    console.log('URL:', page.url());
    
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
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-real-login.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-real-login.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
