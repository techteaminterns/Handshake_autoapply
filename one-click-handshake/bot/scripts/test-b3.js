const { runApplyToJob } = require('../src/flows/applyToJob');

runApplyToJob('https://joinhandshake.com/jobs/12345', 'profile-id-1', 'fake-run-id-3').catch(console.error);
