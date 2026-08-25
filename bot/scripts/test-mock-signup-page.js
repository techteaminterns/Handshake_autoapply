import fs from 'fs';

const pageCode = fs.readFileSync('mock-handshake/src/pages/SignupPage.jsx', 'utf8');

const requiredSelectors = [
  'data-testid="first-name"',
  'data-testid="last-name"',
  'data-testid="student-email"',
  'data-testid="password"',
  'data-testid="confirm-password"',
  'data-testid="signup-next"',
];

let allPassed = true;
for (const sel of requiredSelectors) {
  if (pageCode.includes(sel)) {
    console.log(`[PASS] Found: ${sel}`);
  } else {
    console.error(`[FAIL] Missing selector: ${sel}`);
    allPassed = false;
  }
}

// Verify disabled rule logic in code
if (pageCode.includes('isNextDisabled') && pageCode.includes('disabled={isNextDisabled}')) {
  console.log('[PASS] Found isNextDisabled and disabled binding on Next button');
} else {
  console.error('[FAIL] Missing disabled={isNextDisabled} binding');
  allPassed = false;
}

// Verify context write
if (pageCode.includes('updateFields(') && pageCode.includes("navigate('/onboarding/profile')")) {
  console.log('[PASS] Found updateFields and navigate to /onboarding/profile');
} else {
  console.error('[FAIL] Missing updateFields or navigate call');
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
}

console.log('\nAll SignupPage checks passed successfully!');
