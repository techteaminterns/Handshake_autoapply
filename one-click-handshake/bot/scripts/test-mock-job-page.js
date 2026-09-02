import fs from 'fs';

const pageCode = fs.readFileSync('mock-handshake/src/pages/JobDetailsPage.tsx', 'utf8');

const requiredData = [
  'Assistant Manager',
  'Sprinkle Dreams',
  'Restaurants & Food Service',
  'San Francisco, CA',
  'Full-time',
  'US work authorization required',
  'data-testid="job-apply-btn"',
  'data-testid="job-save-btn"',
  'data-testid="job-salary"',
  'data-testid="job-location"',
  'data-testid="job-type"',
  'data-testid="job-work-auth"',
  'data-testid="job-description"',
];

let allPassed = true;
for (const item of requiredData) {
  if (pageCode.includes(item)) {
    console.log(`[PASS] Found: ${item}`);
  } else {
    console.error(`[FAIL] Missing: ${item}`);
    allPassed = false;
  }
}

// Check salary has 50 and 65K/yr
if (pageCode.includes('50') && pageCode.includes('65K/yr')) {
  console.log('[PASS] Found salary range $50-65K/yr');
} else {
  console.error('[FAIL] Missing salary range');
  allPassed = false;
}

// Check routing to /apply/
if (pageCode.includes('navigate(`/apply/${currentJob.id}`)')) {
  console.log('[PASS] Found navigate to /apply/:jobId');
} else {
  console.error('[FAIL] Missing navigate to /apply/:jobId');
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
}

console.log('\nAll JobDetailsPage checks passed successfully!');
