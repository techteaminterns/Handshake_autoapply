/**
 * worker/index.js
 *
 * Local Node.js worker process entrypoint for OneClickHandshake V1.
 * Orchestrates:
 * 1. Health loop (30-minute interval, session check & AUTH recovery)
 * 2. Scrape loop (24-hour interval, job discovery & Telegram confirmation queue)
 * 3. Apply loop (continuous sequential queue processing with atomic claiming)
 *
 * References:
 * - ProjectDocs/03-workflow.md §System Flow
 * - ProjectDocs/06-implementation.md §Phase V1-A6
 * - ProjectDocs/07-workflow-side-a.md §V1-A6
 * - .cursor/rules/worker.mdc
 */

import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AsyncMutex } from './mutex.js';
import { startHealthLoop } from './healthLoop.js';
import { startScrapeLoop } from './scrapeLoop.js';
import { startApplyLoop } from './applyLoop.js';

dotenv.config();

/**
 * @typedef {object} WorkerContext
 * @property {string} profileId
 * @property {string} workerId
 * @property {AsyncMutex} browserBusy
 * @property {boolean} haltedRateLimit
 * @property {boolean} haltedAuth
 * @property {string|null} openAuthInterventionId
 * @property {boolean} stopped
 * @property {{ healthTimer: any, scrapeTimer: any }} timers
 * @property {{ healthIntervalMs: number, scrapeIntervalMs: number, applyIdleMs: number }} config
 */

/**
 * Creates and initializes a new WorkerContext.
 *
 * @param {object} [options={}]
 * @param {string} [options.profileId]
 * @param {string} [options.workerId]
 * @param {number} [options.healthIntervalMs]
 * @param {number} [options.scrapeIntervalMs]
 * @param {number} [options.applyIdleMs]
 * @returns {WorkerContext}
 */
export function createWorkerContext(options = {}) {
  const profileId = options.profileId || process.env.WORKER_PROFILE_ID;
  const workerId = options.workerId || process.env.WORKER_ID || os.hostname();

  const healthIntervalMs = Number(
    options.healthIntervalMs ?? process.env.HEALTH_INTERVAL_MS ?? 1800000
  );
  const scrapeIntervalMs = Number(
    options.scrapeIntervalMs ?? process.env.SCRAPE_INTERVAL_MS ?? 86400000
  );
  const applyIdleMs = Number(
    options.applyIdleMs ?? process.env.APPLY_IDLE_MS ?? 5000
  );

  return {
    profileId,
    workerId,
    browserBusy: new AsyncMutex(),
    haltedRateLimit: false,
    haltedAuth: false,
    openAuthInterventionId: null,
    stopped: false,
    timers: {
      healthTimer: null,
      scrapeTimer: null,
    },
    config: {
      healthIntervalMs,
      scrapeIntervalMs,
      applyIdleMs,
    },
  };
}

/**
 * Stops all worker loops gracefully.
 *
 * @param {WorkerContext} ctx
 * @returns {Promise<void>}
 */
export async function stopWorker(ctx) {
  console.log(`[worker] Stopping worker ${ctx.workerId} for profile ${ctx.profileId}...`);
  ctx.stopped = true;

  if (ctx.timers.healthTimer) {
    clearTimeout(ctx.timers.healthTimer);
    ctx.timers.healthTimer = null;
  }

  if (ctx.timers.scrapeTimer) {
    clearTimeout(ctx.timers.scrapeTimer);
    ctx.timers.scrapeTimer = null;
  }

  // Wait if a browser operation is currently in-flight
  if (ctx.browserBusy.isLocked()) {
    console.log('[worker] Waiting for in-flight browser task to finish...');
    await ctx.browserBusy.run(() => Promise.resolve());
  }

  console.log(`[worker] Worker ${ctx.workerId} successfully stopped.`);
}

/**
 * Starts all worker loops (health, scrape, apply).
 *
 * @param {object} [options={}]
 * @returns {Promise<{ ctx: WorkerContext, stop: () => Promise<void> }>}
 */
export async function startWorker(options = {}) {
  const ctx = createWorkerContext(options);

  if (!ctx.profileId) {
    throw new Error('WORKER_PROFILE_ID environment variable or option is required to start worker.');
  }

  console.log(`[worker] Initializing worker ${ctx.workerId} for profile ${ctx.profileId}`);
  console.log(`[worker] Health Interval: ${ctx.config.healthIntervalMs}ms | Scrape Interval: ${ctx.config.scrapeIntervalMs}ms | Apply Idle: ${ctx.config.applyIdleMs}ms`);

  // Start background loops
  const stopHealth = startHealthLoop(ctx);
  const stopScrape = startScrapeLoop(ctx);
  startApplyLoop(ctx); // async while-loop runs continuously

  const stop = async () => {
    stopHealth();
    stopScrape();
    await stopWorker(ctx);
  };

  return { ctx, stop };
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  (async () => {
    try {
      const { stop } = await startWorker();

      const shutdown = async (signal) => {
        console.log(`\n[worker] Received ${signal}. Initiating graceful shutdown...`);
        await stop();
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (err) {
      console.error('[worker] Fatal error during startup:', err.message || err);
      process.exit(1);
    }
  })();
}
