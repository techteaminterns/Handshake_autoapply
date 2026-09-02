/**
 * worker/healthLoop.js
 *
 * Session health check loop (30 min interval default, fires immediately on start).
 * Periodically checks whether the Handshake session is active.
 * Handles rate limits, updates browser_profiles monitoring, and creates/recovers
 * AUTH interventions when the session is invalid.
 *
 * References:
 * - ProjectDocs/03-workflow.md §Health / AUTH recovery
 * - ProjectDocs/06-implementation.md §Phase V1-A6
 * - ProjectDocs/07-workflow-side-a.md §V1-A6
 */

import { createSupabaseAdmin } from '../lib/supabase/admin.js';
import {
  getProfile,
  checkAndIncrementActionCount,
  createIntervention,
  updateBrowserProfileHealth,
} from './sideA.js';
import { checkSessionHealth, runSignIn, runSignUp } from './sideB.js';

export { updateBrowserProfileHealth };

/**
 * Executes a single health check tick.
 *
 * @param {import('./index.js').WorkerContext} ctx
 * @returns {Promise<boolean>} session health status
 */
export async function runHealthTick(ctx) {
  if (ctx.stopped) return false;

  // 1. Check rate limit
  const actionAllowed = await checkAndIncrementActionCount(ctx.profileId);
  if (!actionAllowed) {
    ctx.haltedRateLimit = true;
    console.warn(`[healthLoop] Rate limit (300 actions/day) reached for profile ${ctx.profileId}. Health tick halted.`);
    return false;
  }
  ctx.haltedRateLimit = false;

  // 2. Acquire browser mutex to execute session check
  return await ctx.browserBusy.run(async () => {
    const profile = await getProfile(ctx.profileId);
    const isHealthy = await checkSessionHealth(profile);

    await updateBrowserProfileHealth(ctx.profileId, isHealthy);

    if (isHealthy) {
      if (ctx.haltedAuth) {
        console.log(`[healthLoop] Session restored for profile ${ctx.profileId}. Clearing haltedAuth.`);
      }
      ctx.haltedAuth = false;
      ctx.openAuthInterventionId = null;
      return true;
    }

    // Session is NOT healthy
    ctx.haltedAuth = true;
    console.warn(`[healthLoop] Session unhealthy for profile ${ctx.profileId}.`);

    // Check if an OPEN AUTH intervention already exists
    if (!ctx.openAuthInterventionId) {
      const admin = createSupabaseAdmin();
      const { data: existingAuth } = await admin
        .from('interventions')
        .select('id')
        .eq('profile_id', ctx.profileId)
        .eq('type', 'AUTH')
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingAuth) {
        ctx.openAuthInterventionId = existingAuth.id;
      } else {
        const newId = await createIntervention(
          ctx.profileId,
          'AUTH',
          null,
          'Handshake session expired or logged out. Please re-authenticate.',
          null
        );
        ctx.openAuthInterventionId = newId;
        console.warn(`[healthLoop] Created AUTH intervention ${newId} for profile ${ctx.profileId}.`);
      }
    } else {
      // Check if tracked AUTH intervention was resolved
      const admin = createSupabaseAdmin();
      const { data: authRow } = await admin
        .from('interventions')
        .select('status')
        .eq('id', ctx.openAuthInterventionId)
        .maybeSingle();

      if (authRow?.status === 'RESOLVED') {
        console.log(`[healthLoop] AUTH intervention ${ctx.openAuthInterventionId} resolved. Attempting sign in...`);
        if (profile.has_existing_handshake_account) {
          await runSignIn(profile);
        } else {
          await runSignUp(profile);
        }

        const recheck = await checkSessionHealth(profile);
        if (recheck) {
          console.log('[healthLoop] Re-authentication successful; session healthy.');
          ctx.haltedAuth = false;
          ctx.openAuthInterventionId = null;
          await updateBrowserProfileHealth(ctx.profileId, true);
          return true;
        } else {
          console.warn('[healthLoop] Re-authentication completed but session is still unhealthy.');
        }
      }
    }

    return false;
  });
}

/**
 * Starts the recurring health loop.
 *
 * @param {import('./index.js').WorkerContext} ctx
 * @returns {() => void} stop function
 */
export function startHealthLoop(ctx) {
  let timerId = null;

  const tick = async () => {
    if (ctx.stopped) return;
    try {
      await runHealthTick(ctx);
    } catch (err) {
      console.error('[healthLoop] Error in health tick:', err.message || err);
    }

    if (!ctx.stopped) {
      timerId = setTimeout(tick, ctx.config.healthIntervalMs);
      ctx.timers.healthTimer = timerId;
    }
  };

  // Immediate first fire
  tick();

  return () => {
    if (timerId) clearTimeout(timerId);
  };
}
