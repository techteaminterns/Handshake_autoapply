/**
 * worker/sideB.js
 *
 * Side B (Playwright bot) interface stubs for Phase V1-A6.
 * All functions adhere strictly to the signatures in ProjectDocs/07-workflow-side-a.md.
 * In Phase V1-INT (Integration pass), these stubs will be swapped with real Playwright implementations.
 *
 * AGENTS.md rules:
 * - No Playwright imports in worker/.
 * - safeExit is implemented inside Side B functions.
 * - Submits must mark SUBMITTED or FAILED before returning.
 */

import { markJobStatus } from './sideA.js';

/**
 * In-memory mock overrides for testing.
 * @type {Record<string, Function|any>}
 */
let mockOverrides = {};

/**
 * Sets mock overrides for Side B functions during automated testing.
 * @param {Record<string, Function|any>} overrides
 */
export function setSideBMockOverrides(overrides) {
  mockOverrides = { ...mockOverrides, ...overrides };
}

/**
 * Resets all mock overrides to default stub behavior.
 */
export function resetSideBMocks() {
  mockOverrides = {};
}

/**
 * Checks whether the current Handshake browser session is logged in and active.
 *
 * @param {object} profile - Normalized profile object from getProfile
 * @returns {Promise<boolean>} true if session is valid; false if needs login
 */
export async function checkSessionHealth(profile) {
  if (typeof mockOverrides.checkSessionHealth === 'function') {
    return await mockOverrides.checkSessionHealth(profile);
  }
  if (mockOverrides.checkSessionHealth !== undefined) {
    return Boolean(mockOverrides.checkSessionHealth);
  }
  return true;
}

/**
 * Executes a job scrape on Handshake for the given profile and preferences.
 * Returns an array of normalized job descriptors.
 *
 * @param {object} profile - Normalized profile object
 * @param {object} [preferences] - Search filters / preferences
 * @returns {Promise<Array<{
 *   url: string,
 *   title: string,
 *   company: string|null,
 *   location: string|null,
 *   has_quick_apply: boolean,
 *   raw_metadata?: object|null
 * }>>}
 */
export async function runScrape(profile, preferences) {
  if (typeof mockOverrides.runScrape === 'function') {
    return await mockOverrides.runScrape(profile, preferences);
  }
  if (mockOverrides.runScrape !== undefined) {
    return mockOverrides.runScrape;
  }

  // Default fixture scrape result
  const timestamp = Date.now();
  return [
    {
      url: `https://app.joinhandshake.com/jobs/${timestamp}-1`,
      title: 'Software Engineer Intern',
      company: 'Acme Corp',
      location: 'Remote',
      has_quick_apply: true,
      raw_metadata: { source: 'stub_scraper', scraped_at: new Date().toISOString() },
    },
    {
      url: `https://app.joinhandshake.com/jobs/${timestamp}-2`,
      title: 'Frontend Developer',
      company: 'Beta Labs',
      location: 'New York, NY',
      has_quick_apply: true,
      raw_metadata: { source: 'stub_scraper', scraped_at: new Date().toISOString() },
    },
  ];
}

/**
 * Executes the full Handshake application flow for a job.
 * Updates the applications table to SUBMITTED upon success (or FAILED on error).
 *
 * @param {string} jobUrl - Handshake job URL
 * @param {object} profile - Normalized profile object
 * @param {string} applicationId - UUID of the application record
 * @returns {Promise<{ ok: boolean, status: string }>}
 */
export async function runApplyToJob(jobUrl, profile, applicationId) {
  if (typeof mockOverrides.runApplyToJob === 'function') {
    return await mockOverrides.runApplyToJob(jobUrl, profile, applicationId);
  }

  // Simulate brief application processing time
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (applicationId) {
    await markJobStatus(applicationId, 'SUBMITTING', 'submit');
    await markJobStatus(applicationId, 'SUBMITTED', 'verify');
  }

  return { ok: true, status: 'SUBMITTED' };
}

/**
 * Executes the Handshake sign-in flow.
 *
 * @param {object} profile - Normalized profile object
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runSignIn(profile) {
  if (typeof mockOverrides.runSignIn === 'function') {
    return await mockOverrides.runSignIn(profile);
  }
  return { ok: true };
}

/**
 * Executes the Handshake sign-up flow.
 *
 * @param {object} profile - Normalized profile object
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runSignUp(profile) {
  if (typeof mockOverrides.runSignUp === 'function') {
    return await mockOverrides.runSignUp(profile);
  }
  return { ok: true };
}

/**
 * Closes the browser session cleanly.
 *
 * @param {any} [browserSession]
 * @returns {Promise<void>}
 */
export async function safeExit(browserSession) {
  if (typeof mockOverrides.safeExit === 'function') {
    return await mockOverrides.safeExit(browserSession);
  }
}
