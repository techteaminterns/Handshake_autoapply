const { launchBrowser } = require('../src/browser/launch');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    console.log('Navigating to Handshake login page...');
    await page.goto('https://joinhandshake.com/login');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Try to click on Students button first if it's the homepage
    const studentsButton = await page.$('button:has-text("Students")');
    if (studentsButton) {
      console.log('Found Students button, clicking...');
      await studentsButton.click();
      await page.waitForLoadState('networkidle');
    }
    
    // Check if there's a login link/button
    const loginLinks = await page.$$eval('a', links => 
      links.filter(link => link.textContent.toLowerCase().includes('login'))
           .map(link => ({
             text: link.textContent.trim(),
             href: link.href
           }))
    );
    
    console.log('=== LOGIN LINKS ===');
    console.log(JSON.stringify(loginLinks, null, 2));
    
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
    
    console.log('\n=== INPUT FIELDS ===');
    console.log(JSON.stringify(inputs, null, 2));
    
    // Get page title and URL
    console.log('\n=== PAGE INFO ===');
    console.log('Title:', await page.title());
    console.log('URL:', page.url());
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-page-inspect.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-page-inspect.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
