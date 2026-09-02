const { launchBrowser } = require('../src/browser/launch');

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    console.log('Navigating to Handshake...');
    await page.goto('https://joinhandshake.com');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Get page title and URL
    console.log('=== PAGE INFO ===');
    console.log('Title:', await page.title());
    console.log('URL:', page.url());
    
    // Get all text content
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('\n=== PAGE TEXT (first 500 chars) ===');
    console.log(bodyText.substring(0, 500));
    
    // Get all links
    const links = await page.$$eval('a', links => 
      links.slice(0, 20).map(link => ({
        text: link.textContent.trim(),
        href: link.href
      }))
    );
    
    console.log('\n=== FIRST 20 LINKS ===');
    console.log(JSON.stringify(links, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: 'handshake-homepage.png', fullPage: true });
    console.log('\nScreenshot saved: handshake-homepage.png');
    
    // Now try to navigate to login directly
    console.log('\n=== TRYING DIRECT LOGIN NAVIGATION ===');
    await page.goto('https://joinhandshake.com/students/login');
    await page.waitForLoadState('networkidle');
    
    console.log('After navigation to students/login:');
    console.log('Title:', await page.title());
    console.log('URL:', page.url());
    
    // Check for input fields on this page
    const inputs = await page.$$eval('input', inputs => 
      inputs.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        className: input.className
      }))
    );
    
    console.log('\n=== INPUT FIELDS ON STUDENTS/LOGIN ===');
    console.log(JSON.stringify(inputs, null, 2));
    
    await page.screenshot({ path: 'handshake-students-login.png', fullPage: true });
    console.log('Screenshot saved: handshake-students-login.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
