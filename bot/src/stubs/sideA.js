// These are FAKE. Replace each with a real import from Side A at B4.

async function getResumeUrl(profileId) {
  return 'https://example.com/fake-resume.pdf';
}

async function getReusableAnswer(profileId, questionText) {
  return null; // simulate "never answered before" so fallback path gets tested
}

async function pauseAndRequestAnswer(profileId, questionText) {
  console.log(`[STUB] Would pause + Telegram-ask: "${questionText}"`);
  return 'This is a fixture answer for testing.';
}

async function pauseForLiveHandoff(runId, contextLabel) {
  console.log(`[STUB] Would pause for live handoff: ${contextLabel}`);
  return true; // pretend user completed it instantly
}

async function readOtpFromGmail(profileId) {
  return '123456'; // fake OTP
}

async function checkAndIncrementActionCount(runId) {
  return true; // pretend under the 300/day cap
}

async function markRunStatus(runId, status, failureReason = null) {
  console.log(`[STUB] bot_runs status → ${status}`, failureReason || '');
}

module.exports = {
  getResumeUrl,
  getReusableAnswer,
  pauseAndRequestAnswer,
  pauseForLiveHandoff,
  readOtpFromGmail,
  checkAndIncrementActionCount,
  markRunStatus,
};
