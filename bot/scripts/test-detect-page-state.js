/**
 * test-detect-page-state.js
 *
 * Verifies detectPageState(page) logic across different URL & DOM fixtures.
 */

const { detectPageState } = require('../src/flows/otpLogin');
const { launchBrowser } = require('../src/browser/launch');
const { safeExit } = require('../src/safeExit');

async function testDetectPageState() {
  console.log('=== Testing detectPageState logic ===\n');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Intercept Handshake domain routes for fast mocked page responses
  await page.route('https://app.joinhandshake.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body><div id="root">Mock Handshake Root</div></body></html>',
    });
  });

  let passed = 0;
  let total = 0;

  async function assertState(description, setupFn, expectedState) {
    total++;
    console.log(`Test ${total}: ${description}`);
    await setupFn();
    const result = await detectPageState(page, 2000);
    if (result === expectedState) {
      console.log(`  ✅ Passed: got ${result}\n`);
      passed++;
    } else {
      console.error(`  ❌ Failed: expected ${expectedState}, got ${result}\n`);
    }
  }

  try {
    // Test 1: Onboarding URL pattern
    await assertState(
      'Onboarding URL pattern (https://app.joinhandshake.com/onboarding/profile)',
      async () => {
        await page.goto('https://app.joinhandshake.com/onboarding/profile');
      },
      'ONBOARDING'
    );

    // Test 2: Dashboard URL pattern
    await assertState(
      'Dashboard URL pattern (https://app.joinhandshake.com/stu/postings)',
      async () => {
        await page.goto('https://app.joinhandshake.com/stu/postings');
      },
      'DASHBOARD'
    );

    // Test 2b: Fellow Projects URL pattern
    await assertState(
      'Fellow Projects URL pattern (https://app.joinhandshake.com/fellow/projects)',
      async () => {
        await page.goto('https://app.joinhandshake.com/fellow/projects');
      },
      'DASHBOARD'
    );

    // Test 3: Generic URL with Onboarding DOM marker
    await assertState(
      'Generic URL with Onboarding DOM markers (resume input + next step)',
      async () => {
        await page.goto('https://app.joinhandshake.com/access');
        await page.setContent(`
          <html>
            <body>
              <form action="/submit">
                <input data-testid="resume-field-file-input" type="file" />
                <button data-testid="expertise-step-next">Next</button>
              </form>
            </body>
          </html>
        `);
      },
      'ONBOARDING'
    );

    // Test 4: Generic URL with Dashboard DOM marker
    await assertState(
      'Generic URL with Dashboard DOM markers (main navigation)',
      async () => {
        await page.goto('https://app.joinhandshake.com/access');
        await page.setContent(`
          <html>
            <body>
              <nav aria-label="Main Navigation">
                <a href="/stu/jobs">Jobs</a>
                <a href="/stu/messages">Messages</a>
              </nav>
            </body>
          </html>
        `);
      },
      'DASHBOARD'
    );

    // Test 5: Auth Error DOM alert
    await assertState(
      'Auth error alert on page',
      async () => {
        await page.goto('https://app.joinhandshake.com/access');
        await page.setContent(`
          <html>
            <body>
              <div role="alert">Invalid code. Please try again.</div>
            </body>
          </html>
        `);
      },
      'AUTH_ERROR'
    );

    // Test 6: Unknown state timeout
    await assertState(
      'Unrecognized page returns UNKNOWN',
      async () => {
        await page.goto('https://app.joinhandshake.com/access');
        await page.setContent('<html><body><div>Random blank content</div></body></html>');
      },
      'UNKNOWN'
    );

    console.log(`========================================`);
    console.log(`Results: ${passed}/${total} assertions passed`);
    console.log(`========================================\n`);

    if (passed !== total) {
      process.exitCode = 1;
    }
  } finally {
    await safeExit(browser);
  }
}

testDetectPageState().catch(console.error);
