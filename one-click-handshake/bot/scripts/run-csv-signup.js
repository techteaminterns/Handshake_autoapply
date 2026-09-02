const path = require('path');
const { readLatestProfile } = require('../src/data/csvProfile');
const { runCreateAccount } = require('../src/flows/createAccount');

const csvFile = process.env.PROFILE_CSV
  ? path.resolve(process.env.PROFILE_CSV)
  : undefined;

try {
  const profile = readLatestProfile(csvFile);
  const runId = `csv-signup-${Date.now()}`;

  console.log(`Starting CSV-backed signup for ${profile.studentEmail}`);
  runCreateAccount(profile, runId).catch(error => {
    console.error('CSV signup failed:', error.message);
    process.exitCode = 1;
  });
} catch (error) {
  console.error('CSV signup cannot start:', error.message);
  process.exitCode = 1;
}
