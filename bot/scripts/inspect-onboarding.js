const { launchBrowser } = require('../src/browser/launch');

(async () => {
  console.log('Inspecting Handshake onboarding flow...');
  const browser = await launchBrowser(false); // non-headless to bypass Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // Navigate to login
    await page.goto('https://app.joinhandshake.com/access');
    await page.waitForTimeout(3000);
    
    console.log('=== LOGIN PAGE ANALYSIS ===');
    const loginInputs = await page.$$eval('input', inputs => 
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className
      }))
    );
    console.log('Login inputs:', JSON.stringify(loginInputs, null, 2));
    
    console.log('\n=== PLEASE MANUALLY COMPLETE THE FLOW ===');
    console.log('I will monitor each page and show you what fields are present.');
    console.log('Press Ctrl+C to stop when you reach the main page.\n');
    
    // Monitor page changes
    let lastUrl = page.url();
    let pageCount = 0;
    
    page.on('load', async () => {
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        pageCount++;
        lastUrl = currentUrl;
        console.log(`\n=== PAGE ${pageCount}: ${currentUrl} ===`);
        
        // Get all inputs
        const inputs = await page.$$eval('input', inputs => 
          inputs.map(input => ({
            type: input.type,
            name: input.name,
            id: input.id,
            placeholder: input.placeholder,
            className: input.className
          }))
        );
        console.log('Inputs:', JSON.stringify(inputs, null, 2));
        
        // Get all buttons
        const buttons = await page.$$eval('button', buttons => 
          buttons.map(button => ({
            text: button.textContent.trim(),
            type: button.type,
            className: button.className
          }))
        );
        console.log('Buttons:', JSON.stringify(buttons, null, 2));
        
        // Take screenshot
        await page.screenshot({ path: `onboarding-page-${pageCount}.png`, fullPage: true });
        console.log(`Screenshot saved: onboarding-page-${pageCount}.png`);
      }
    });
    
    // Keep browser open for manual navigation
    console.log('Browser is now open. Please complete the onboarding manually.');
    console.log('I will monitor each page change and show you the fields.');
    console.log('Press Ctrl+C in this terminal when done.\n');
    
    // Wait indefinitely (user will Ctrl+C to stop)
    await new Promise(resolve => {
      // This will never resolve, user will Ctrl+C
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
