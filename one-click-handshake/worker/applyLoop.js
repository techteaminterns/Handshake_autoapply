/**
 * worker/applyLoop.js
 *
 * Continuous sequential job application loop.
 * Atomically claims pending QUEUED applications one at a time using `claimNextJob` (RPC),
 * holds the browserBusy mutex during the entire application attempt (`runApplyToJob`),
 * and guarantees that a second job is never claimed until the first reaches terminal status.
 *
 * References:
 * - ProjectDocs/03-workflow.md §Application Loop
 * - ProjectDocs/06-implementation.md §Phase V1-A6
 * - ProjectDocs/07-workflow-side-a.md §V1-A6
 * - .cursor/rules/worker.mdc
 */

import {
  getProfile,
  claimNextJob,
  markJobStatus,
  checkAndIncrementActionCount,
  getJob,
} from './sideA.js';
import { runApplyToJob } from './sideB.js';

/**
 * Executes a single step of the apply loop.
 *
 * @param {import('./index.js').WorkerContext} ctx
 * @returns {Promise<{ processed: boolean, applicationId?: string, reason?: string }>}
 */
export async function runApplyStep(ctx) {
  if (ctx.stopped) return { processed: false, reason: 'stopped' };

  if (ctx.haltedAuth) {
    return { processed: false, reason: 'halted_auth' };
  }

  if (ctx.haltedRateLimit) {
    return { processed: false, reason: 'halted_rate_limit' };
  }

  // 1. Rate limit gate before claiming next job
  const actionAllowed = await checkAndIncrementActionCount(ctx.profileId);
  if (!actionAllowed) {
    ctx.haltedRateLimit = true;
    console.warn(`[applyLoop] Rate limit (300 actions/day) reached for profile ${ctx.profileId}. Apply loop paused.`);
    return { processed: false, reason: 'halted_rate_limit' };
  }

  // 2. Atomically claim next QUEUED application
  const application = await claimNextJob(ctx.profileId, ctx.workerId);
  if (!application) {
    // Queue is empty
    return { processed: false, reason: 'queue_empty' };
  }

  console.log(`[applyLoop] Claimed application ${application.id} for job ${application.job_id}. Processing...`);

  // 3. Acquire browser mutex for the entire application duration
  await ctx.browserBusy.run(async () => {
    try {
      const job = await getJob(application.job_id);

      // Fetch normalized profile
      const profile = await getProfile(ctx.profileId);

      // Execute Side B application flow
      const result = await runApplyToJob(job.url, profile, application.id);
      console.log(`[applyLoop] Application ${application.id} completed with status: ${result?.status || 'SUBMITTED'}`);
    } catch (err) {
      console.error(`[applyLoop] Error applying to application ${application.id}:`, err.message || err);
      // Ensure application status is marked terminal on error
      try {
        await markJobStatus(application.id, 'FAILED', err.message || 'Application failed with unhandled error');
      } catch (markErr) {
        console.error(`[applyLoop] Failed to mark application ${application.id} as FAILED:`, markErr.message);
      }
    }
  });

  return { processed: true, applicationId: application.id };
}

/**
 * Starts the continuous apply loop.
 *
 * @param {import('./index.js').WorkerContext} ctx
 * @returns {Promise<void>}
 */
export async function startApplyLoop(ctx) {
  console.log(`[applyLoop] Starting continuous apply loop for profile ${ctx.profileId} (worker: ${ctx.workerId})...`);

  while (!ctx.stopped) {
    try {
      const stepResult = await runApplyStep(ctx);

      if (ctx.stopped) break;

      // Sleep if queue was empty or worker was halted
      if (!stepResult.processed) {
        await new Promise((resolve) => setTimeout(resolve, ctx.config.applyIdleMs));
      }
    } catch (loopErr) {
      console.error('[applyLoop] Unexpected error in apply loop iteration:', loopErr.message || loopErr);
      if (!ctx.stopped) {
        await new Promise((resolve) => setTimeout(resolve, ctx.config.applyIdleMs));
      }
    }
  }

  console.log(`[applyLoop] Apply loop stopped for profile ${ctx.profileId}.`);
}
