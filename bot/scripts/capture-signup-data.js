const { launchBrowser } = require('../src/browser/launch');
const { createObjectCsvWriter } = require('csv-writer');

(async () => {
  console.log('=== Handshake Signup Data Capture ===');
  console.log('This script will monitor and capture all data you enter during signup.\n');
  
  const browser = await launchBrowser(false); // non-headless to bypass Cloudflare
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Store all captured data
  const capturedData = {
    timestamp: new Date().toISOString(),
    email: '',
    firstName: '',
    lastName: '',
    mobileNumber: '',
    school: '',
    linkedinUrl: '',
    otherFields: {}
  };

  try {
    // Navigate to login/signup
    await page.goto('https://app.joinhandshake.com/access');
    await page.waitForTimeout(3000);
    
    console.log('Browser opened. Please complete the signup process manually.');
    console.log('I will monitor all fields and capture your data.\n');
    
    // Monitor input changes
    let monitoring = true;
    let lastCheckTime = Date.now();
    
    while (monitoring) {
      await page.waitForTimeout(3000); // Check every 3 seconds
      
      // Get all input fields
      const inputs = await page.$$eval('input', inputs => 
        inputs.map(input => ({
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          value: input.value
        }))
      );
      
      // Capture data from filled fields
      for (const input of inputs) {
        if (input.type !== 'hidden' && input.type !== 'submit' && input.value && input.value.trim().length > 0) {
          const fieldName = input.name || input.placeholder || input.id || 'unknown';
          
          // Store in appropriate field
          if (fieldName.includes('email') || fieldName.includes('Email')) {
            if (input.value !== capturedData.email) {
              capturedData.email = input.value;
              console.log(`✓ Captured email: ${input.value}`);
            }
          } else if (fieldName.includes('first') || fieldName.includes('First')) {
            if (input.value !== capturedData.firstName) {
              capturedData.firstName = input.value;
              console.log(`✓ Captured first name: ${input.value}`);
            }
          } else if (fieldName.includes('last') || fieldName.includes('Last')) {
            if (input.value !== capturedData.lastName) {
              capturedData.lastName = input.value;
              console.log(`✓ Captured last name: ${input.value}`);
            }
          } else if (fieldName.includes('phone') || fieldName.includes('mobile') || fieldName.includes('Phone')) {
            if (input.value !== capturedData.mobileNumber) {
              capturedData.mobileNumber = input.value;
              console.log(`✓ Captured mobile: ${input.value}`);
            }
          } else if (fieldName.includes('school') || fieldName.includes('School')) {
            if (input.value !== capturedData.school) {
              capturedData.school = input.value;
              console.log(`✓ Captured school: ${input.value}`);
            }
          } else if (fieldName.includes('linkedin') || fieldName.includes('LinkedIn')) {
            if (input.value !== capturedData.linkedinUrl) {
              capturedData.linkedinUrl = input.value;
              console.log(`✓ Captured LinkedIn: ${input.value}`);
            }
          } else {
            // Store other fields
            if (!capturedData.otherFields[fieldName] || capturedData.otherFields[fieldName] !== input.value) {
              capturedData.otherFields[fieldName] = input.value;
              console.log(`✓ Captured ${fieldName}: ${input.value}`);
            }
          }
        }
      }
      
      // Check if we're on main page (signup complete)
      const currentUrl = page.url();
      if (currentUrl.includes('jobs') || currentUrl.includes('employers') || currentUrl.includes('home')) {
        console.log('\n=== Signup Complete - Main Page Reached ===');
        monitoring = false;
      }
      
      // Safety timeout (30 minutes max)
      if (Date.now() - lastCheckTime > 30 * 60 * 1000) {
        console.log('\n=== Timeout reached. Saving captured data... ===');
        monitoring = false;
      }
    }
    
    // Save to CSV
    console.log('\n=== Saving captured data to CSV ===');
    
    // Prepare headers dynamically based on captured fields
    const headers = [
      { id: 'timestamp', title: 'TIMESTAMP' },
      { id: 'email', title: 'EMAIL' },
      { id: 'firstName', title: 'FIRST_NAME' },
      { id: 'lastName', title: 'LAST_NAME' },
      { id: 'mobileNumber', title: 'MOBILE_NUMBER' },
      { id: 'school', title: 'SCHOOL' },
      { id: 'linkedinUrl', title: 'LINKEDIN_URL' },
    ];
    
    // Add other fields as headers
    for (const [fieldName, value] of Object.entries(capturedData.otherFields)) {
      headers.push({ id: `other_${fieldName}`, title: fieldName.toUpperCase() });
    }
    
    const csvWriter = createObjectCsvWriter({
      path: 'handshake_signup_data.csv',
      header: headers,
      append: true,
    });
    
    // Prepare record
    const record = {
      timestamp: capturedData.timestamp,
      email: capturedData.email,
      firstName: capturedData.firstName,
      lastName: capturedData.lastName,
      mobileNumber: capturedData.mobileNumber,
      school: capturedData.school,
      linkedinUrl: capturedData.linkedinUrl,
    };
    
    // Add other fields
    for (const [fieldName, value] of Object.entries(capturedData.otherFields)) {
      record[`other_${fieldName}`] = value;
    }
    
    await csvWriter.writeRecords([record]);
    console.log('✓ Data saved to handshake_signup_data.csv');
    
    console.log('\n=== Captured Data Summary ===');
    console.log(JSON.stringify(capturedData, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    console.log('\nPress Enter to close browser...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before closing
    await browser.close();
  }
})();
