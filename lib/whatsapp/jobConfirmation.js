/**
 * lib/whatsapp/jobConfirmation.js
 *
 * WhatsApp Job Confirmation State Machine & Messaging Utility:
 * 1. Formats and dispatches job confirmation prompts to user's WhatsApp.
 * 2. Advances the confirmation queue (enforcing 1 unconfirmed prompt per user at a time).
 * 3. Handles inbound replies ("YES", "NO", etc.) and calls `resolve_job_confirmation` RPC.
 * 4. Polling utility to wait for user reply resolution in tests and workflows.
 */

import { createSupabaseAdmin } from '../supabase/admin.js';
import { sendWhatsAppMessage } from './client.js';

/**
 * Formats the standard WhatsApp message prompt for a discovered Handshake job.
 *
 * @param {object} job
 * @param {string} job.title - Job title
 * @param {string} [job.company] - Company name
 * @param {string} [job.location] - Location
 * @param {string} job.url - Handshake job URL
 * @returns {string} Formatted prompt text
 */
export function formatWhatsAppJobConfirmationMessage(job) {
  const title = job.title || 'Job Opening';
  const companyPart = job.company ? ` at *${job.company}*` : '';
  const locationPart = job.location ? `\n📍 ${job.location}` : '';
  const urlPart = job.url ? `\n🔗 ${job.url}` : '';

  return (
    `📢 *New Handshake Job Opportunity*\n\n` +
    `*${title}*${companyPart}${locationPart}${urlPart}\n\n` +
    `👉 Reply *YES* to queue your application, or *NO* to skip.`
  );
}

/**
 * Returns the active unconfirmed (pending) job for a profile on WhatsApp.
 * A pending job has `whatsapp_prompt_sent_at` set and `whatsapp_prompt_resolved_at` null.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} profileId
 * @returns {Promise<object|null>}
 */
export async function getPendingWhatsAppConfirmationJob(supabase, profileId) {
  const client = supabase || createSupabaseAdmin();

  const { data, error } = await client
    .from('handshake_jobs')
    .select('*')
    .eq('profile_id', profileId)
    .not('whatsapp_prompt_sent_at', 'is', null)
    .is('whatsapp_prompt_resolved_at', null)
    .order('whatsapp_prompt_sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[whatsapp/jobConfirmation] getPendingWhatsAppConfirmationJob error:', error.message);
    return null;
  }

  return data || null;
}

/**
 * Returns the next discovered job awaiting WhatsApp confirmation for a profile.
 * Picks oldest unprompted job (`discovered_at ASC`) without an application row.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} profileId
 * @returns {Promise<object|null>}
 */
export async function getNextWhatsAppJobAwaitingPrompt(supabase, profileId) {
  const client = supabase || createSupabaseAdmin();

  const { data, error } = await client
    .from('handshake_jobs')
    .select('*, applications(id)')
    .eq('profile_id', profileId)
    .is('whatsapp_prompt_sent_at', null)
    .order('discovered_at', { ascending: true });

  if (error) {
    console.error('[whatsapp/jobConfirmation] getNextWhatsAppJobAwaitingPrompt error:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const nextJob = data.find((job) => !job.applications || job.applications.length === 0);
  return nextJob || null;
}

/**
 * Sends a job confirmation prompt for a specific job to the user's WhatsApp
 * and records the `whatsapp_prompt_sent_at` timestamp on `handshake_jobs`.
 *
 * @param {string} profileId - Target profile UUID
 * @param {string|object} jobOrJobId - Handshake job object or job UUID
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {string} [options.phone] - User WhatsApp phone number (if already loaded)
 * @param {Function} [options.whatsappSendFn] - Optional override for sendWhatsAppMessage
 * @returns {Promise<{ ok: boolean, job?: object, error?: string, messageResult?: object }>}
 */
export async function sendWhatsAppJobConfirmation(profileId, jobOrJobId, options = {}) {
  const client = options.supabase || createSupabaseAdmin();
  const sendFn = options.whatsappSendFn || sendWhatsAppMessage;

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
      console.error('[whatsapp/jobConfirmation] Job not found for id:', jobOrJobId, error?.message);
      return { ok: false, error: 'job_not_found' };
    }
    job = data;
  } else if (jobOrJobId && typeof jobOrJobId === 'object') {
    job = jobOrJobId;
  } else {
    return { ok: false, error: 'invalid_job_argument' };
  }

  // 2. Resolve WhatsApp phone number
  let phone = options.phone;
  if (!phone) {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('whatsapp_phone, phone')
      .eq('id', profileId)
      .maybeSingle();

    if (profileError || (!profile?.whatsapp_phone && !profile?.phone)) {
      console.warn('[whatsapp/jobConfirmation] Profile has no linked WhatsApp phone:', profileId);
      return { ok: false, error: 'no_whatsapp_phone' };
    }
    phone = profile.whatsapp_phone || profile.phone;
  }

  // 3. Format and send prompt
  const messageText = formatWhatsAppJobConfirmationMessage(job);
  const messageResult = await sendFn(profileId, phone, messageText);

  if (!messageResult || messageResult.ok === false) {
    console.error('[whatsapp/jobConfirmation] Failed to deliver prompt to phone:', phone, messageResult?.error);
    return { ok: false, error: 'send_failed', messageResult };
  }

  // 4. Stamp whatsapp_prompt_sent_at on handshake_jobs
  const sentAt = new Date().toISOString();
  const { error: updateError } = await client
    .from('handshake_jobs')
    .update({ whatsapp_prompt_sent_at: sentAt })
    .eq('id', job.id);

  if (updateError) {
    console.error('[whatsapp/jobConfirmation] Failed to stamp whatsapp_prompt_sent_at:', updateError.message);
    return { ok: false, error: 'stamp_failed', job, messageResult };
  }

  return {
    ok: true,
    job: { ...job, whatsapp_prompt_sent_at: sentAt },
    messageResult,
  };
}

/**
 * Advances the WhatsApp job confirmation queue for a profile:
 * 1. Checks if the profile already has an unconfirmed job prompt (enforce 1 at a time).
 * 2. Checks if profile has a linked WhatsApp phone.
 * 3. Finds next unprompted job awaiting confirmation.
 * 4. Sends prompt and stamps `whatsapp_prompt_sent_at`.
 *
 * @param {string} profileId - User profile UUID
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {Function} [options.whatsappSendFn]
 * @returns {Promise<{ status: 'already_pending'|'no_whatsapp_phone'|'queue_empty'|'sent'|'error', job?: object, messageResult?: object, error?: string }>}
 */
export async function advanceWhatsAppConfirmationQueue(profileId, options = {}) {
  const client = options.supabase || createSupabaseAdmin();

  // Step 1: Ensure only one pending job at a time
  const pendingJob = await getPendingWhatsAppConfirmationJob(client, profileId);
  if (pendingJob) {
    return { status: 'already_pending', job: pendingJob };
  }

  // Step 2: Check WhatsApp linkage
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('whatsapp_phone, phone')
    .eq('id', profileId)
    .maybeSingle();

  const phone = profile?.whatsapp_phone || profile?.phone;
  if (profileError || !phone) {
    console.warn('[whatsapp/jobConfirmation] advanceWhatsAppConfirmationQueue: profile has no whatsapp_phone', profileId);
    return { status: 'no_whatsapp_phone' };
  }

  // Step 3: Pick next job awaiting prompt
  const nextJob = await getNextWhatsAppJobAwaitingPrompt(client, profileId);
  if (!nextJob) {
    return { status: 'queue_empty' };
  }

  // Step 4: Send prompt
  const sendResult = await sendWhatsAppJobConfirmation(profileId, nextJob, {
    supabase: client,
    phone,
    whatsappSendFn: options.whatsappSendFn,
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
 * Atomically resolves a pending WhatsApp job confirmation via `resolve_job_confirmation` RPC.
 *
 * @param {string} profileId - User profile UUID
 * @param {string} jobId - Handshake job UUID
 * @param {'yes'|'no'} decision - User decision
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @returns {Promise<{ status: string, error?: string }>}
 */
export async function resolveWhatsAppPendingConfirmation(profileId, jobId, decision, options = {}) {
  const client = options.supabase || createSupabaseAdmin();

  try {
    const { data, error } = await client.rpc('resolve_job_confirmation', {
      p_profile_id: profileId,
      p_job_id: jobId,
      p_decision: decision,
    });

    if (error) {
      console.error('[whatsapp/jobConfirmation] resolve_job_confirmation RPC Postgres Error:', error.message);
      return { status: 'error', error: error.message };
    }

    console.log(`[whatsapp/jobConfirmation] resolve_job_confirmation RPC success -> status="${data}" (profileId=${profileId}, jobId=${jobId}, decision=${decision})`);
    return { status: data };
  } catch (err) {
    console.error('[whatsapp/jobConfirmation] resolve_job_confirmation exception:', err.message);
    return { status: 'error', error: err.message };
  }
}

/**
 * Parses user inbound text to determine YES/NO decision.
 *
 * @param {string} text
 * @returns {'yes'|'no'|null}
 */
export function parseDecisionFromText(text) {
  if (!text) return null;
  const clean = text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  if (['yes', 'y', 'apply', 'queue', '1', 'yep', 'yeah', 'sure', 'ok'].includes(clean)) {
    return 'yes';
  }
  if (['no', 'n', 'skip', 'reject', '2', 'nope', 'pass'].includes(clean)) {
    return 'no';
  }
  return null;
}

/**
 * Handles an inbound WhatsApp text reply from a user.
 *
 * @param {string} profileId - User profile UUID
 * @param {string} senderPhoneOrJid - Sender phone or JID
 * @param {string} text - Message text
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {Function} [options.whatsappSendFn]
 * @returns {Promise<{ handled: boolean, decision?: string, status?: string, job?: object }>}
 */
export async function handleWhatsAppInboundReply(profileId, senderPhoneOrJid, text, options = {}) {
  const client = options.supabase || createSupabaseAdmin();
  const sendFn = options.whatsappSendFn || sendWhatsAppMessage;

  console.log(`[whatsapp/jobConfirmation] Processing inbound reply for profile ${profileId}: "${text}"`);

  // 1. Find active pending job confirmation
  const pendingJob = await getPendingWhatsAppConfirmationJob(client, profileId);
  if (!pendingJob) {
    console.log(`[whatsapp/jobConfirmation] No pending WhatsApp confirmation for profile ${profileId}. Ignoring reply.`);
    return { handled: false, reason: 'no_pending_job' };
  }

  // 2. Parse decision
  const decision = parseDecisionFromText(text);

  if (!decision) {
    console.log(`[whatsapp/jobConfirmation] Unrecognized decision text: "${text}". Sending guidance prompt.`);
    await sendFn(
      profileId,
      senderPhoneOrJid,
      `Please reply *YES* to apply for "${pendingJob.title}" or *NO* to skip.`
    );
    return { handled: true, reason: 'unrecognized_decision', job: pendingJob };
  }

  // 3. Resolve pending confirmation via atomic RPC
  const { status, error } = await resolveWhatsAppPendingConfirmation(
    profileId,
    pendingJob.id,
    decision,
    { supabase: client }
  );

  if (error) {
    console.error('[whatsapp/jobConfirmation] Failed to resolve confirmation:', error);
    return { handled: false, error };
  }

  // 4. Send acknowledgment feedback
  if (status === 'resolved') {
    const jobTitle = pendingJob.title || 'Job Opening';
    if (decision === 'yes') {
      await sendFn(
        profileId,
        senderPhoneOrJid,
        `👍 Got it! Application for *${jobTitle}* is queued and will be processed.`
      );
    } else {
      await sendFn(
        profileId,
        senderPhoneOrJid,
        `Skipped *${jobTitle}*.`
      );
    }

    // Auto-advance confirmation queue for next waiting job
    await advanceWhatsAppConfirmationQueue(profileId, {
      supabase: client,
      whatsappSendFn: sendFn,
    });
  }

  return {
    handled: true,
    decision,
    status,
    job: pendingJob,
  };
}

/**
 * Polls the applications table until a job reaches QUEUED / REJECTED status or timeout.
 * Useful for automated tests and orchestration harnesses.
 *
 * @param {string} profileId
 * @param {string} jobId
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=30000]
 * @param {number} [options.intervalMs=1500]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @returns {Promise<object|null>}
 */
export async function pollForWhatsAppReply(profileId, jobId, options = {}) {
  const client = options.supabase || createSupabaseAdmin();
  const timeoutMs = options.timeoutMs || 30000;
  const intervalMs = options.intervalMs || 1500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data: app, error } = await client
      .from('applications')
      .select('*')
      .eq('profile_id', profileId)
      .eq('job_id', jobId)
      .maybeSingle();

    if (!error && app && (app.status === 'QUEUED' || app.status === 'REJECTED')) {
      return app;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}
