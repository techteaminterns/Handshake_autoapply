/**
 * sideA.js — Side A helpers called by Side B (bot) Playwright flows.
 *
 * readOtpFromGmail is now wired to the real implementation in
 * lib/gmail/readOtpFromGmail.js (Phase A4).
 *
 * All other functions remain stubs until their respective phases:
 *   - getResumeUrl:              replace at B4
 *   - getReusableAnswer:         replace at B5 (Telegram fallback wiring)
 *   - pauseAndRequestAnswer:     replace at B5
 *   - pauseForLiveHandoff:       replace at B6 (live handoff)
 *   - checkAndIncrementActionCount: replace at B3 (rate limit wiring)
 *   - markRunStatus:             replace at B3 (bot_runs status wiring)
 */

// readOtpFromGmail is an ES-module export — import it via dynamic import so
// this CJS file (required by Playwright flows) can call it without converting
// the entire bot/src tree to ESM.
let _readOtpFromGmail = null;
async function loadReadOtp() {
  if (!_readOtpFromGmail) {
    // Resolve relative to the repo root (this file lives at bot/src/stubs/)
    const mod = await import('../../../lib/gmail/readOtpFromGmail.js');
    _readOtpFromGmail = mod.readOtpFromGmail;
  }
  return _readOtpFromGmail;
}

async function getResumeUrl(profileId) {
  // TODO (B4): replace with real Supabase Storage signed URL lookup
  return 'https://example.com/fake-resume.pdf';
}

async function getReusableAnswer(profileId, questionText) {
  // TODO (B5): replace with real reusable_answers DB lookup
  return null; // null = "never answered before" → triggers Telegram fallback
}

async function pauseAndRequestAnswer(profileId, questionText) {
  // TODO (B5): replace with workflow-level pause + Telegram message
  console.log(`[STUB] Would pause + Telegram-ask: "${questionText}"`);
  return 'This is a fixture answer for testing.';
}

async function pauseForLiveHandoff(runId, contextLabel) {
  // TODO (B6): replace with workflow-level pause + live handoff signal
  console.log(`[STUB] Would pause for live handoff: ${contextLabel}`);
  console.log(`[STUB] Waiting 10 seconds to simulate human intervention...`);
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
  console.log(`[STUB] Human intervention completed for: ${contextLabel}`);
  return true; // pretend user completed it instantly
}

/**
 * Read the Handshake OTP from the user's Gmail inbox.
 * Phase A4: wired to the real implementation.
 *
 * @param {string} profileId  — Supabase user UUID
 * @returns {Promise<string>}  6-digit OTP code
 */
async function readOtpFromGmail(profileId) {
  const fn = await loadReadOtp();
  return fn(profileId);
}

async function checkAndIncrementActionCount(runId) {
  // TODO (B3): replace with real bot_runs.actions_count check + increment
  return true; // pretend under the 300/day cap
}

async function markRunStatus(runId, status, failureReason = null) {
  // TODO (B3): replace with real bot_runs status update
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
