const { runOtpLogin } = require('../src/flows/otpLogin');
const profile = require('../src/fixtures/profile');

runOtpLogin(profile, 'fake-run-id-2').catch(console.error);
