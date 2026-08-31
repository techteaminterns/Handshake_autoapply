/**
 * bot/src/stubs/sideA.js
 *
 * Dynamic-import bridge from the CommonJS Playwright bot (bot/) to the ESM
 * worker/sideA.js where all real Side A functions live.
 *
 * All stubs replaced at Phase V1-A5. Side B may call any function here —
 * the bridge loads the real implementation on first call and caches the module.
 *
 * Functions implemented in worker/sideA.js (real, tested):
 *   getProfile, getResumeUrl, claimNextJob, markJobStatus,
 *   createIntervention, resolveIntervention, storeJobsFromScrape,
 *   checkAndIncrementActionCount
 *
 * readOtpFromGmail — still wired to lib/gmail/readOtpFromGmail.js (Phase A4).
 *
 * Phase: V1-A5
 */

'use strict';

let _sideA = null;

/** @returns {Promise<typeof import('../../../worker/sideA.js')>} */
async function loadSideA() {
  if (!_sideA) {
    // Resolve relative to repo root (this file is at bot/src/stubs/)
    _sideA = await import('../../../worker/sideA.js');
  }
  return _sideA;
}

// readOtpFromGmail is still wired to lib/gmail — keep separate loader
let _readOtpFromGmail = null;
async function loadReadOtp() {
  if (!_readOtpFromGmail) {
    const mod = await import('../../../lib/gmail/readOtpFromGmail.js');
    _readOtpFromGmail = mod.readOtpFromGmail;
  }
  return _readOtpFromGmail;
}

// ---------------------------------------------------------------------------
// Bridge wrappers — forward every call to worker/sideA.js
// ---------------------------------------------------------------------------

async function getProfile(profileId) {
  const m = await loadSideA();
  return m.getProfile(profileId);
}

async function getResumeUrl(profileId) {
  const m = await loadSideA();
  return m.getResumeUrl(profileId);
}

async function claimNextJob(profileId, workerId) {
  const m = await loadSideA();
  return m.claimNextJob(profileId, workerId);
}

async function markJobStatus(applicationId, status, stepOrReason) {
  const m = await loadSideA();
  return m.markJobStatus(applicationId, status, stepOrReason);
}

async function createIntervention(profileId, type, applicationId, questionText, options) {
  const m = await loadSideA();
  return m.createIntervention(profileId, type, applicationId, questionText, options);
}

async function resolveIntervention(interventionId, timeoutMs) {
  const m = await loadSideA();
  return m.resolveIntervention(interventionId, timeoutMs);
}

async function storeJobsFromScrape(profileId, jobs) {
  const m = await loadSideA();
  return m.storeJobsFromScrape(profileId, jobs);
}

async function checkAndIncrementActionCount(profileId) {
  const m = await loadSideA();
  return m.checkAndIncrementActionCount(profileId);
}

async function readOtpFromGmail(profileId) {
  const fn = await loadReadOtp();
  return fn(profileId);
}

module.exports = {
  getProfile,
  getResumeUrl,
  claimNextJob,
  markJobStatus,
  createIntervention,
  resolveIntervention,
  storeJobsFromScrape,
  checkAndIncrementActionCount,
  readOtpFromGmail,
};
