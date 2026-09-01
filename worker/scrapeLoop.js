/**
 * worker/scrapeLoop.js
 *
 * Daily job scraping loop (24h cadence default, fires immediately on start).
 * Periodically scrapes Handshake for new job listings matching user profile preferences,
 * stores them in `handshake_jobs`, and advances the Telegram confirmation prompt queue.
 *
 * References:
 * - ProjectDocs/03-workflow.md §Scraping
 * - ProjectDocs/06-implementation.md §Phase V1-A6
 * - ProjectDocs/07-workflow-side-a.md §V1-A6
 */

import { getProfile, checkAndIncrementActionCount, storeJobsFromScrape } from './sideA.js';
import { runScrape } from './sideB.js';
import { advanceConfirmationQueue } from '../lib/telegram/jobConfirmation.js';

/**
 * Executes a single job scrape tick.
 *
 * @param {import('./index.js').WorkerContext} ctx
 * @returns {Promise<{ ok: boolean, newCount?: number, skipped?: boolean, reason?: string }>}
 */
export async function runScrapeTick(ctx) {
  if (ctx.stopped) return { ok: false, skipped: true, reason: 'stopped' };

  if (ctx.haltedAuth) {
    console.log(`[scrapeLoop] Skipping scrape tick for profile ${ctx.profileId}: session is halted on AUTH.`);
    return { ok: false, skipped: true, reason: 'halted_auth' };
  }

  if (ctx.haltedRateLimit) {
    console.log(`[scrapeLoop] Skipping scrape tick for profile ${ctx.profileId}: rate limit reached.`);
    return { ok: false, skipped: true, reason: 'halted_rate_limit' };
  }

  // 1. Rate limit check
  const actionAllowed = await checkAndIncrementActionCount(ctx.profileId);
  if (!actionAllowed) {
    ctx.haltedRateLimit = true;
    console.warn(`[scrapeLoop] Rate limit (300 actions/day) reached for profile ${ctx.profileId}. Scrape tick halted.`);
    return { ok: false, skipped: true, reason: 'halted_rate_limit' };
  }

  // 2. Acquire browser mutex to execute scrape
  return await ctx.browserBusy.run(async () => {
    const profile = await getProfile(ctx.profileId);
    const preferences = {
      job_types: profile.job_types,
      locations: profile.locations_open_to,
      job_interests: profile.job_interests,
    };

    console.log(`[scrapeLoop] Executing job scrape for profile ${ctx.profileId}...`);
    const scrapedJobs = await runScrape(profile, preferences);

    if (!scrapedJobs || scrapedJobs.length === 0) {
      console.log(`[scrapeLoop] Scraper returned 0 jobs for profile ${ctx.profileId}.`);
      return { ok: true, newCount: 0 };
    }

    // 3. Store discovered jobs into handshake_jobs
    const newCount = await storeJobsFromScrape(ctx.profileId, scrapedJobs);
    console.log(`[scrapeLoop] Stored ${scrapedJobs.length} jobs (${newCount} new) for profile ${ctx.profileId}.`);

    // 4. Advance Telegram confirmation queue
    try {
      const confirmResult = await advanceConfirmationQueue(ctx.profileId);
      console.log(`[scrapeLoop] Telegram confirmation queue advanced: ${confirmResult.status}`);
    } catch (teleErr) {
      console.error('[scrapeLoop] Error advancing Telegram confirmation queue:', teleErr.message || teleErr);
    }

    return { ok: true, newCount };
  });
}

/**
 * Starts the recurring scrape loop.
 *
 * @param {import('./index.js').WorkerContext} ctx
 * @returns {() => void} stop function
 */
export function startScrapeLoop(ctx) {
  let timerId = null;

  const tick = async () => {
    if (ctx.stopped) return;
    try {
      await runScrapeTick(ctx);
    } catch (err) {
      console.error('[scrapeLoop] Error in scrape tick:', err.message || err);
    }

    if (!ctx.stopped) {
      timerId = setTimeout(tick, ctx.config.scrapeIntervalMs);
      ctx.timers.scrapeTimer = timerId;
    }
  };

  // Immediate first fire
  tick();

  return () => {
    if (timerId) clearTimeout(timerId);
  };
}
