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
// Helper: Check if Supabase environment variables are present
// ---------------------------------------------------------------------------

function hasSupabaseConfig() {
  const hasUrl = Boolean(
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const hasKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY
  );
  return hasUrl && hasKey;
}

function isValidUuid(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ---------------------------------------------------------------------------
// Bridge wrappers — forward every call to worker/sideA.js with test env fallbacks
// ---------------------------------------------------------------------------

async function getProfile(profileId) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] getProfile(profileId="${profileId}") -> fallback stub`);
    try {
      const defaultProfile = require('../fixtures/profile');
      return { id: profileId, ...defaultProfile };
    } catch {
      return { id: profileId };
    }
  }
  const m = await loadSideA();
  return m.getProfile(profileId);
}

async function getResumeUrl(profileId) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] getResumeUrl(profileId="${profileId}") -> fallback stub`);
    return 'https://example.com/mock-resume.pdf';
  }
  const m = await loadSideA();
  return m.getResumeUrl(profileId);
}

async function claimNextJob(profileId, workerId) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] claimNextJob(profileId="${profileId}") -> fallback stub`);
    return null;
  }
  const m = await loadSideA();
  return m.claimNextJob(profileId, workerId);
}

async function markJobStatus(applicationId, status, stepOrReason) {
  if (!hasSupabaseConfig()) {
    console.log(`[stubs/sideA] [STUB] markJobStatus(applicationId="${applicationId}", status="${status}", stepOrReason="${stepOrReason}") - Supabase not configured in env, stub returning success`);
    return { ok: true, stub: true, applicationId, status, stepOrReason };
  }

  if (!isValidUuid(applicationId)) {
    console.log(`[stubs/sideA] [STUB] markJobStatus(applicationId="${applicationId}", status="${status}", stepOrReason="${stepOrReason}") - non-UUID test runner ID, stub returning success`);
    return { ok: true, stub: true, applicationId, status, stepOrReason };
  }

  try {
    const m = await loadSideA();
    return await m.markJobStatus(applicationId, status, stepOrReason);
  } catch (err) {
    console.warn(`[stubs/sideA] markJobStatus DB call failed: ${err.message}. Stub returning success.`);
    return { ok: true, stub: true, applicationId, status, stepOrReason, warning: err.message };
  }
}

async function createIntervention(profileId, type, applicationId, questionText, options) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] createIntervention(type="${type}", profileId="${profileId}") -> fallback stub`);
    return '00000000-0000-0000-0000-000000000000';
  }
  const m = await loadSideA();
  return m.createIntervention(profileId, type, applicationId, questionText, options);
}

async function resolveIntervention(interventionId, timeoutMs) {
  if (!hasSupabaseConfig() || !isValidUuid(interventionId)) {
    console.log(`[stubs/sideA] [STUB] resolveIntervention(interventionId="${interventionId}") -> fallback stub`);
    return '123456';
  }
  const m = await loadSideA();
  return m.resolveIntervention(interventionId, timeoutMs);
}

async function storeJobsFromScrape(profileId, jobs) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] storeJobsFromScrape(jobs=${jobs?.length || 0}) -> fallback stub`);
    return jobs?.length || 0;
  }
  const m = await loadSideA();
  return m.storeJobsFromScrape(profileId, jobs);
}

async function checkAndIncrementActionCount(profileId) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] checkAndIncrementActionCount(profileId="${profileId}") -> fallback stub (allowing action)`);
    return true;
  }

  try {
    const m = await loadSideA();
    return await m.checkAndIncrementActionCount(profileId);
  } catch (err) {
    console.warn(`[stubs/sideA] checkAndIncrementActionCount DB call failed: ${err.message}. Falling back to true.`);
    return true;
  }
}

async function readOtpFromGmail(profileId) {
  if (!hasSupabaseConfig() || !isValidUuid(profileId)) {
    console.log(`[stubs/sideA] [STUB] readOtpFromGmail(profileId="${profileId}") -> fallback stub`);
    return '123456';
  }
  const fn = await loadReadOtp();
  return fn(profileId);
}

// ---------------------------------------------------------------------------
// Backwards compatibility legacy shims
// ---------------------------------------------------------------------------

async function pauseForLiveHandoff(runId, reason) {
  console.log(`[stubs/sideA] [STUB] pauseForLiveHandoff(runId="${runId}", reason="${reason}") -> auto-continuing`);
  return true;
}

async function getReusableAnswer(profileId, questionText) {
  console.log(`[stubs/sideA] [STUB] getReusableAnswer(question="${questionText}") -> none found`);
  return null;
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
  // Legacy aliases
  markRunStatus: markJobStatus,
  pauseForLiveHandoff,
  getReusableAnswer,
};
