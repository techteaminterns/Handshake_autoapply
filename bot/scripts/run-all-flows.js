const { runOtpLogin } = require('../src/flows/otpLogin');
const { runApplyToJob } = require('../src/flows/applyToJob');
const profile = require('../src/fixtures/profile');

(async () => {
  console.log('=== Running Handshake Bot Flows ===\n');
  
  const runId = 'integrated-test-run-' + Date.now();
  
  try {
    // Phase B2: OTP Login Flow (working flow)
    console.log('🚀 Starting Phase B2: OTP Login Flow...');
    await runOtpLogin(profile, runId + '-b2');
    console.log('✅ Phase B2 completed\n');
    
    // Phase B3: Apply to Job Flow (requires job link)
    console.log('🚀 Starting Phase B3: Apply to Job Flow...');
    await runApplyToJob('https://app.joinhandshake.com/jobs/12345', 'profile-id-1', runId + '-b3');
    console.log('✅ Phase B3 completed\n');
    
    console.log('=== All Working Flows Completed Successfully ===');
  } catch (error) {
    console.error('❌ Error in flow execution:', error.message);
    process.exit(1);
  }
})();
