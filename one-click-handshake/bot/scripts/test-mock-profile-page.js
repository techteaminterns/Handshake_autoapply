import fs from 'fs';

const pageCode = fs.readFileSync('mock-handshake/src/pages/onboarding/ProfilePage.jsx', 'utf8');

const requiredSelectors = [
  'data-testid="profile-first-name"',
  'data-testid="profile-last-name"',
  'data-testid="profile-school-name"',
  'data-testid="profile-education-level"',
  'data-testid="profile-grad-month"',
  'data-testid="profile-grad-year"',
  'data-testid="profile-major-0"',
  'data-testid="profile-add-major"',
  'data-testid="profile-personal-email"',
  'data-testid="profile-confirm"',
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

// Check School of Life prefill & disabled
if (pageCode.includes("school") && pageCode.includes("School of Life") && pageCode.includes("disabled")) {
  console.log('[PASS] School of Life disabled/locked');
} else {
  console.error('[FAIL] School of Life disabled state check failed');
  allPassed = false;
}

// Check helper text
if (pageCode.includes('This email will be used to access Handshake after you graduate.')) {
  console.log('[PASS] Personal email helper text present');
} else {
  console.error('[FAIL] Personal email helper text missing');
  allPassed = false;
}

// Check updateFields and navigate
if (pageCode.includes('updateFields(') && pageCode.includes("navigate('/onboarding/job-type')")) {
  console.log('[PASS] Found updateFields and navigate to /onboarding/job-type');
} else {
  console.error('[FAIL] Missing updateFields or navigate call');
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
}

console.log('\nAll ProfilePage checks passed successfully!');
