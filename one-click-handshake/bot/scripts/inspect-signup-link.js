const { launchBrowser } = require('../src/browser/launch');

(async () => {
  console.log('Inspecting Sign up link...');
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await page.goto('https://app.joinhandshake.com/access');
    await page.waitForTimeout(3000);
    
    // Get all links
    const links = await page.$$eval('a', links => 
      links.map(link => ({
        text: link.textContent.trim(),
        href: link.href,
        className: link.className
      }))
    );
    
    console.log('=== ALL LINKS ===');
    console.log(JSON.stringify(links, null, 2));
    
    // Try different selectors for Sign up
    console.log('\n=== TESTING SELECTORS ===');
    
    const signUpLinks = await page.$$eval('a', links => 
      links.filter(link => link.textContent.toLowerCase().includes('sign'))
           .map(link => ({
        text: link.textContent.trim(),
        href: link.href,
        className: link.className
      }))
    );
    
    console.log('Sign up related links:', JSON.stringify(signUpLinks, null, 2));
    
    await page.screenshot({ path: 'signup-links-inspect.png', fullPage: true });
    console.log('\nScreenshot saved: signup-links-inspect.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
