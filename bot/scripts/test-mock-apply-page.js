import fs from 'fs';

const pageCode = fs.readFileSync('mock-handshake/src/pages/ApplyPage.tsx', 'utf8');

const requiredData = [
  'data-testid="resume-upload-btn"',
  'data-testid="cover-letter-upload-btn"',
  'data-testid="submit-application-btn"',
  'Search your CVs',
  'Search your cover letters',
  '2022 Resume',
  'new_resume_fall_21.pdf',
  'cover_letter_2019.pdf',
  'Details from',
  'Applying for Assistant Manager requires a few documents',
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

// Check disabled rule on submit button
if (pageCode.includes('isSubmitDisabled') && pageCode.includes('!resumeFile')) {
  console.log('[PASS] Found disabled condition until resumeFile is present');
} else {
  console.error('[FAIL] Missing disabled condition on submit button');
  allPassed = false;
}

// Check console log and navigation to /done
if (pageCode.includes('console.log(') && pageCode.includes("navigate('/done')")) {
  console.log('[PASS] Found console.log and navigate to /done');
} else {
  console.error('[FAIL] Missing console.log or navigate to /done');
  allPassed = false;
}

if (!allPassed) {
  process.exit(1);
}

console.log('\nAll ApplyPage checks passed successfully!');
