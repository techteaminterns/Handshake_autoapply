const { runCreateAccount } = require('../src/flows/createAccount');
const profile = require('../src/fixtures/profile');

runCreateAccount(profile, 'fake-run-id-1').catch(console.error);
