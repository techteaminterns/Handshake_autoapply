const { runManualGuidedLogin } = require('../src/flows/manualGuidedLogin');

runManualGuidedLogin('fake-run-id-manual').catch(console.error);
