const { runManualGuidedLogin } = require('./manualGuidedLogin');

async function runCreateAccount(profile, runId) {
  return runManualGuidedLogin(runId, profile);
}

module.exports = { runCreateAccount };

