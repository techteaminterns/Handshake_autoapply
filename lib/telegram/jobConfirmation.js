/**
 * lib/telegram/jobConfirmation.js
 *
 * Phase V1-A4: Telegram Job Confirmation State Machine & Send Utility
 *
 * Provides utilities to:
 * 1. Format and send job confirmation prompts via Telegram.
 * 2. Advance the confirmation queue (enforcing 1 unconfirmed prompt per user at a time).
 * 3. Query unconfirmed pending jobs and unprompted jobs awaiting confirmation.
 * 4. Atomically resolve user yes/no replies via the `resolve_job_confirmation` RPC.
 *
 * References:
 * - ProjectDocs/03-workflow.md §4-6, §Edge Cases
 * - ProjectDocs/05-backend-schema.md
 * - ProjectDocs/07-workflow-side-a.md §V1-A4
 */

import { createSupabaseAdmin } from '../supabase/admin.js';
import { sendTelegramMessage } from '../../api/telegram/webhook.js';

/**
 * Builds the Telegram InlineKeyboardMarkup object containing Yes/No buttons for a job.
 *
 * @param {string} jobId - Handshake job UUID
 * @returns {object} InlineKeyboardMarkup structure
 */
export function buildJobConfirmationKeyboard(jobId) {
  return {
    inline_keyboard: [
      [
        { text: 'Yes', callback_data: `job:yes:${jobId}` },
        { text: 'No', callback_data: `job:no:${jobId}` },
      ],
    ],
  };
}

/**
 * Formats the standard Telegram prompt for a discovered Handshake job.
 *
 * @param {object} job
 * @param {string} job.title - Job title
 * @param {string} [job.company] - Company name
 * @param {string} job.url - Handshake job URL
 * @returns {string} Formatted prompt text
 */
export function formatJobConfirmationMessage(job) {
  const title = job.title || 'Job Opening';
  const companyPart = job.company ? ` at ${job.company}` : '';
  const url = job.url || '';

  return `Apply to ${title}${companyPart}?\n${url}\n\nTap Yes to queue or No to skip.`;
}

/**
 * Returns the active unconfirmed (pending) job for a profile, if one exists.
 * A pending job has `telegram_prompt_sent_at` set and `telegram_prompt_resolved_at` null.
 * If multiple exist due to rare races, returns the most recent prompt.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} profileId
 * @returns {Promise<object|null>}
 */
export async function getPendingConfirmationJob(supabase, profileId) {
  const client = supabase || createSupabaseAdmin();

  const { data, error } = await client
    .from('handshake_jobs')
    .select('*')
    .eq('profile_id', profileId)
    .not('telegram_prompt_sent_at', 'is', null)
    .is('telegram_prompt_resolved_at', null)
    .order('telegram_prompt_sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[telegram/jobConfirmation] getPendingConfirmationJob error:', error.message);
    return null;
  }

  return data || null;
}

/**
 * Returns the next discovered job awaiting Telegram confirmation for a profile.
 * Picks the oldest unprompted job (`discovered_at ASC`) that does not already have
 * an application row.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} profileId
 * @returns {Promise<object|null>}
 */
export async function getNextJobAwaitingPrompt(supabase, profileId) {
  const client = supabase || createSupabaseAdmin();

  const { data, error } = await client
    .from('handshake_jobs')
    .select('*, applications(id)')
    .eq('profile_id', profileId)
    .is('telegram_prompt_sent_at', null)
    .order('discovered_at', { ascending: true });

  if (error) {
    console.error('[telegram/jobConfirmation] getNextJobAwaitingPrompt error:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Filter for jobs without an existing application record
  const nextJob = data.find((job) => !job.applications || job.applications.length === 0);
  return nextJob || null;
}

/**
 * Sends a job confirmation prompt for a specific job to the user's Telegram chat
 * and records the `telegram_prompt_sent_at` timestamp on `handshake_jobs`.
 *
 * @param {string} profileId - Target profile UUID
 * @param {string|object} jobOrJobId - Handshake job object or job UUID
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {string|number} [options.chatId] - User Telegram chat ID (if already loaded)
 * @param {Function} [options.telegramSendFn] - Optional mock/override for sendTelegramMessage
 * @returns {Promise<{ ok: boolean, job?: object, error?: string, messageResult?: object }>}
 */
export async function sendJobConfirmation(profileId, jobOrJobId, options = {}) {
  const client = options.supabase || createSupabaseAdmin();
  const sendFn = options.telegramSendFn || sendTelegramMessage;

  // 1. Resolve job object
  let job = null;
  if (typeof jobOrJobId === 'string') {
    const { data, error } = await client
      .from('handshake_jobs')
      .select('*')
      .eq('id', jobOrJobId)
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error || !data) {
      console.error('[telegram/jobConfirmation] sendJobConfirmation job not found:', jobOrJobId, error?.message);
      return { ok: false, error: 'job_not_found' };
    }
    job = data;
  } else if (jobOrJobId && typeof jobOrJobId === 'object') {
    job = jobOrJobId;
  } else {
    return { ok: false, error: 'invalid_job_argument' };
  }

  // 2. Resolve chatId
  let chatId = options.chatId;
  if (!chatId) {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', profileId)
      .maybeSingle();

    if (profileError || !profile?.telegram_chat_id) {
      console.warn('[telegram/jobConfirmation] User has no telegram_chat_id linked:', profileId);
      return { ok: false, error: 'no_telegram_chat_id' };
    }
    chatId = profile.telegram_chat_id;
  }

  // 3. Format and send prompt with inline keyboard
  const messageText = formatJobConfirmationMessage(job);
  const replyMarkup = buildJobConfirmationKeyboard(job.id);
  const messageResult = await sendFn(chatId, messageText, {
    reply_markup: replyMarkup,
  });

  // If sendFn failed (returned null or ok === false)
  if (!messageResult || messageResult.ok === false) {
    console.error('[telegram/jobConfirmation] Failed to deliver prompt to chat_id:', chatId);
    return { ok: false, error: 'send_failed', messageResult };
  }

  // 4. Stamp telegram_prompt_sent_at on handshake_jobs
  const sentAt = new Date().toISOString();
  const { error: updateError } = await client
    .from('handshake_jobs')
    .update({ telegram_prompt_sent_at: sentAt })
    .eq('id', job.id);

  if (updateError) {
    console.error('[telegram/jobConfirmation] Failed to stamp telegram_prompt_sent_at:', updateError.message);
    return { ok: false, error: 'stamp_failed', job, messageResult };
  }

  return {
    ok: true,
    job: { ...job, telegram_prompt_sent_at: sentAt },
    messageResult,
  };
}

/**
 * Advances the job confirmation queue for a profile:
 * 1. Checks if the profile already has an unconfirmed job prompt -> if so, returns early (1 pending at a time).
 * 2. Checks if the profile has a linked Telegram chat -> if not, logs and skips.
 * 3. Finds the next unprompted job awaiting confirmation (`discovered_at ASC`).
 * 4. Sends the prompt and stamps `telegram_prompt_sent_at`.
 *
 * @param {string} profileId - User profile UUID
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {Function} [options.telegramSendFn]
 * @returns {Promise<{ status: 'already_pending'|'no_telegram_chat_id'|'queue_empty'|'sent'|'error', job?: object, messageResult?: object, error?: string }>}
 */
export async function advanceConfirmationQueue(profileId, options = {}) {
  const client = options.supabase || createSupabaseAdmin();

  // Step 1: Ensure only one pending job per user at a time
  const pendingJob = await getPendingConfirmationJob(client, profileId);
  if (pendingJob) {
    return { status: 'already_pending', job: pendingJob };
  }

  // Step 2: Check Telegram linkage
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('telegram_chat_id')
    .eq('id', profileId)
    .maybeSingle();

  if (profileError || !profile?.telegram_chat_id) {
    console.warn('[telegram/jobConfirmation] advanceConfirmationQueue: profile has no telegram_chat_id', profileId);
    return { status: 'no_telegram_chat_id' };
  }

  // Step 3: Pick next job awaiting prompt
  const nextJob = await getNextJobAwaitingPrompt(client, profileId);
  if (!nextJob) {
    return { status: 'queue_empty' };
  }

  // Step 4: Send prompt
  const sendResult = await sendJobConfirmation(profileId, nextJob, {
    supabase: client,
    chatId: profile.telegram_chat_id,
    telegramSendFn: options.telegramSendFn,
  });

  if (!sendResult.ok) {
    return { status: 'error', error: sendResult.error, job: nextJob };
  }

  return {
    status: 'sent',
    job: sendResult.job,
    messageResult: sendResult.messageResult,
  };
}

/**
 * Atomically resolves a pending job confirmation via the `resolve_job_confirmation` RPC.
 *
 * Return statuses:
 * - 'resolved': Application row inserted (QUEUED for yes, REJECTED for no), prompt marked resolved.
 * - 'ignored_duplicate': Job prompt was already resolved or not found.
 * - 'ignored_permanent_reject': Application was previously REJECTED; cannot queue.
 * - 'ignored_already_queued': Application was previously QUEUED; cannot reject.
 * - 'ignored_terminal': Application is in a terminal or in-flight status.
 * - 'ignored_invalid_decision': Decision was not 'yes' or 'no'.
 *
 * @param {string} profileId - User profile UUID
 * @param {string} jobId - Handshake job UUID
 * @param {'yes'|'no'} decision - User decision
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @returns {Promise<{ status: string, error?: string }>}
 */
export async function resolvePendingConfirmation(profileId, jobId, decision, options = {}) {
  const client = options.supabase || createSupabaseAdmin();

  try {
    const { data, error } = await client.rpc('resolve_job_confirmation', {
      p_profile_id: profileId,
      p_job_id: jobId,
      p_decision: decision,
    });

    if (error) {
      console.error('[telegram/jobConfirmation] resolve_job_confirmation RPC Postgres Error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        profileId,
        jobId,
        decision,
      });
      return { status: 'error', error: error.message };
    }

    console.log(`[telegram/jobConfirmation] resolve_job_confirmation RPC success -> status="${data}" (profileId=${profileId}, jobId=${jobId}, decision=${decision})`);
    return { status: data };
  } catch (err) {
    console.error('[telegram/jobConfirmation] resolve_job_confirmation RPC Exception:', {
      message: err.message,
      stack: err.stack,
      profileId,
      jobId,
      decision,
    });
    return { status: 'error', error: err.message };
  }
}
