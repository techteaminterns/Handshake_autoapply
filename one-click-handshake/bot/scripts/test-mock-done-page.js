import fs from 'fs';

const pageCode = fs.readFileSync('mock-handshake/src/pages/DonePage.tsx', 'utf8');

const requiredData = [
  'data-testid="apply-complete"',
  'Application submitted!',
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

if (!allPassed) {
  process.exit(1);
}

console.log('\nAll DonePage checks passed successfully!');
