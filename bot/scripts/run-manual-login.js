const { runManualGuidedLogin } = require('../src/flows/manualGuidedLogin');

(async () => {
  console.log('Starting manual guided login flow...');
  const runId = 'test-run-' + Date.now();
  
  try {
    await runManualGuidedLogin(runId);
    console.log('✅ Manual guided login completed successfully!');
  } catch (error) {
    console.error('❌ Error during manual guided login:', error.message);
    process.exit(1);
  }
})();
