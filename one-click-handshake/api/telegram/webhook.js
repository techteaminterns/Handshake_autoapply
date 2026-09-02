/**
 * POST /api/telegram/webhook
 *
 * Receives and processes Telegram Bot API Update objects.
 *
 * Handled Events:
 * 1. `/start <supabase_user_id>` (Phase A3):
 *    - Triggered when the user taps the "Link Telegram" deep link in the React Native app.
 *    - Extracts the user ID and stores `chat_id` into `profiles.telegram_chat_id`.
 *    - Sends an immediate confirmation message back to the user on Telegram.
 *    - If the user has not completed onboarding yet, prompts them to submit the form first.
 *
 * 2. Inbound messages / replies (Phase A7 ready):
 *    - Dispatches non-command messages to `onTelegramReply(chatId, message, update)`.
 *    - Ready for Phase A7 to resume paused Vercel Workflow steps and store answers in `reusable_answers`.
 *
 * Security & Design Constraints:
 * - Single app-level secret `TELEGRAM_BOT_TOKEN` in env vars (never per-user).
 * - Scoped Supabase service-role client used exclusively to update the matched user profile.
 * - Always returns HTTP 200 to acknowledge delivery and prevent Telegram webhook retries.
 */

import fs from 'fs';
import path from 'path';
import { createSupabaseAdmin } from '../../lib/supabase/admin.js';
import {
  getPendingConfirmationJob,
  resolvePendingConfirmation,
  advanceConfirmationQueue,
} from '../../lib/telegram/jobConfirmation.js';

/**
 * Appends an entry to logs/webhook.log for debugging Telegram webhook connectivity.
 *
 * @param {string} message - Message to append to the log file.
 */
export function logToWebhookFile(message) {
  try {
    const logsDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(logsDir, 'webhook.log');
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (err) {
    console.error('[telegram/webhook] Failed to write to webhook.log:', err.message);
  }
}

/**
 * Sends a text message to a specific Telegram chat ID.
 *
 * Purpose:
 *   Reusable, generic messaging utility for system notifications, deep-link confirmations,
 *   and Phase A7 dynamic application screening Q&A prompts.
 *
 * @param {string|number} chatId - Target Telegram chat identifier.
 * @param {string} text - Message text content (supports Markdown or HTML formatting).
 * @param {object} [options={}] - Optional Telegram sendMessage parameters.
 * @param {'HTML'|'Markdown'|'MarkdownV2'} [options.parse_mode] - Formatting mode for message text.
 * @param {object} [options.reply_markup] - Inline keyboard markup or custom reply markup.
 * @param {number} [options.reply_to_message_id] - Specific message ID to reply to.
 * @returns {Promise<object|null>} Resolves with the Telegram API response object on success ({ ok: true, result: ... }), or null if failed.
 */
export async function sendTelegramMessage(chatId, text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN is not configured');
    return null;
  }

  if (!chatId || !text) {
    console.warn('[telegram/webhook] sendTelegramMessage missing chatId or text', { chatId, text });
    return null;
  }

  const telegramApi = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(telegramApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode,
        reply_markup: options.reply_markup,
        reply_to_message_id: options.reply_to_message_id,
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('[telegram/webhook] Telegram API sendMessage error:', result.description);
    }
    return result;
  } catch (err) {
    console.error('[telegram/webhook] sendTelegramMessage fetch exception:', err.message);
    return null;
  }
}

/**
 * Answers a Telegram callback query to dismiss the client loading spinner.
 *
 * @param {string} callbackQueryId - Unique identifier for the callback query.
 * @param {object} [options={}] - Optional parameters (e.g. text, show_alert).
 * @param {string} [options.text] - Notification toast text.
 * @param {boolean} [options.show_alert] - If true, displays an alert dialog instead of toast.
 * @returns {Promise<object|null>}
 */
export async function answerTelegramCallbackQuery(callbackQueryId, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN is not configured');
    return null;
  }

  if (!callbackQueryId) {
    console.warn('[telegram/webhook] answerTelegramCallbackQuery missing callbackQueryId');
    return null;
  }

  const telegramApi = `https://api.telegram.org/bot${token}/answerCallbackQuery`;

  try {
    const response = await fetch(telegramApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: options.text,
        show_alert: options.show_alert,
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('[telegram/webhook] Telegram API answerCallbackQuery error:', result.description);
    }
    return result;
  } catch (err) {
    console.error('[telegram/webhook] answerTelegramCallbackQuery fetch exception:', err.message);
    return null;
  }
}

/**
 * Edits the inline keyboard markup of an existing Telegram message (e.g. to strip buttons).
 *
 * @param {string|number} chatId - Telegram chat identifier.
 * @param {number} messageId - Identifier of the message to edit.
 * @param {object|null} [replyMarkup=null] - New reply markup, or null / { inline_keyboard: [] } to remove.
 * @returns {Promise<object|null>}
 */
export async function editTelegramMessageReplyMarkup(chatId, messageId, replyMarkup = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN is not configured');
    return null;
  }

  if (!chatId || !messageId) {
    console.warn('[telegram/webhook] editTelegramMessageReplyMarkup missing chatId or messageId', { chatId, messageId });
    return null;
  }

  const telegramApi = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;

  try {
    const response = await fetch(telegramApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: replyMarkup || { inline_keyboard: [] },
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('[telegram/webhook] Telegram API editMessageReplyMarkup error:', result.description);
    }
    return result;
  } catch (err) {
    console.error('[telegram/webhook] editTelegramMessageReplyMarkup fetch exception:', err.message);
    return null;
  }
}

/**
 * Handler for incoming Telegram callback queries (inline button clicks).
 *
 * Phase V1-A4 Implementation:
 *   1. Answers the callback query to dismiss the client loading spinner.
 *   2. Matches sender `chatId` to a user profile via `profiles.telegram_chat_id`.
 *   3. Parses callback_data with format ^job:(yes|no):(<uuid>)$.
 *   4. Calls `resolvePendingConfirmation` atomic RPC to create QUEUED/REJECTED application row and resolve prompt.
 *   5. On resolved: acknowledges decision to user, strips inline buttons from original message, and advances queue.
 *   6. On ignored / duplicate: strips inline buttons and logs.
 *
 * @param {object} callbackQuery - Telegram CallbackQuery object.
 * @param {object} [update={}] - Full Telegram Update payload.
 * @param {object} [options={}] - Dependency injection options for testing.
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {Function} [options.telegramSendFn]
 * @param {Function} [options.telegramAnswerFn]
 * @param {Function} [options.telegramEditMarkupFn]
 * @returns {Promise<void>}
 */
export async function onTelegramCallbackQuery(callbackQuery, _update = {}, options = {}) {
  const queryId = callbackQuery?.id;
  const data = callbackQuery?.data || '';
  const chatId = callbackQuery?.message?.chat?.id || callbackQuery?.from?.id;
  const messageId = callbackQuery?.message?.message_id;

  logToWebhookFile(`CALLBACK_QUERY RECEIVED - id=${queryId}, chat_id=${chatId}, data="${data}"`);
  console.log(`[telegram/webhook] Inbound callback_query received: id=${queryId}, chat_id=${chatId}, data="${data}"`);

  const answerFn = options.telegramAnswerFn || answerTelegramCallbackQuery;
  const editMarkupFn = options.telegramEditMarkupFn || editTelegramMessageReplyMarkup;
  const sendFn = options.telegramSendFn || sendTelegramMessage;

  // 1. Answer callback query immediately to stop the client spinner
  if (queryId) {
    await answerFn(queryId);
  }

  if (!chatId) {
    console.warn('[telegram/webhook] callback_query missing chatId');
    return;
  }

  const supabase = options.supabase || (() => {
    try {
      return createSupabaseAdmin();
    } catch (err) {
      console.error('[telegram/webhook] Failed to initialize Supabase admin client:', err.message);
      return null;
    }
  })();

  if (!supabase) return;

  // 2. Parse callback_data: ^job:(yes|no):([0-9a-fA-F-]+)$
  const match = data.match(/^job:(yes|no):([0-9a-fA-F-]+)$/i);
  if (!match) {
    console.warn('[telegram/webhook] Unrecognized callback_data format:', data);
    return;
  }

  const decision = match[1].toLowerCase();
  const jobId = match[2];

  // 3. Look up the job from handshake_jobs by jobId to get authoritative profile_id
  const { data: jobData, error: jobError } = await supabase
    .from('handshake_jobs')
    .select('id, profile_id, title')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !jobData) {
    console.warn('[telegram/webhook] Job not found in handshake_jobs for jobId:', jobId, jobError?.message);
    return;
  }

  // 4. Look up profile associated with this Telegram chat ID
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, telegram_chat_id')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();

  if (profileError) {
    console.error('[telegram/webhook] Profile lookup error for chat_id:', chatId, profileError.message);
  }

  // Authoritative target profile ID is the job owner (jobData.profile_id)
  const targetProfileId = jobData.profile_id || profile?.id;

  if (!targetProfileId) {
    console.error('[telegram/webhook] Unable to resolve profileId for jobId:', jobId, 'chatId:', chatId);
    return;
  }

  // Ensure telegram_chat_id is recorded on target profile if missing
  if (profile && profile.id !== targetProfileId) {
    console.log(`[telegram/webhook] Note: chat_id=${chatId} linked to profile "${profile.id}", but job belongs to profile "${targetProfileId}". Using "${targetProfileId}".`);
  } else if (!profile && chatId) {
    console.log(`[telegram/webhook] Auto-linking telegram_chat_id=${chatId} to job owner profile "${targetProfileId}"`);
    await supabase
      .from('profiles')
      .update({ telegram_chat_id: String(chatId) })
      .eq('id', targetProfileId);
  }

  console.log(`CALLBACK HANDLER ENTERED - jobId: ${jobId}, profileId: ${targetProfileId}, decision: ${decision}`);
  console.log(`[telegram/webhook] Processing callback: decision="${decision}", jobId="${jobId}", profileId="${targetProfileId}"`);

  // 5. Atomically resolve the pending confirmation
  console.log('CALLING RPC - resolve_job_confirmation');
  const { status, error } = await resolvePendingConfirmation(
    targetProfileId,
    jobId,
    decision,
    { supabase }
  );

  console.log('RPC RETURNED - status: ' + status);
  console.log(`[telegram/webhook] resolve_job_confirmation RPC returned status: "${status}" for profileId="${targetProfileId}"`, error ? `error: ${error}` : '');

  if (error) {
    console.error('[telegram/webhook] Error resolving job confirmation via callback:', error);
    return;
  }

  // 6. Handle RPC resolution status
  if (status === 'resolved') {
    // Strip inline keyboard buttons from the original message so user cannot re-click
    if (messageId) {
      await editMarkupFn(chatId, messageId, { inline_keyboard: [] });
    }

    const jobTitle = jobData.title || 'Job Opening';

    console.log('INSERTING APPLICATION (verifying created row in Supabase)...');
    // Verify created application row in database
    const { data: createdApp, error: appCheckErr } = await supabase
      .from('applications')
      .select('id, profile_id, job_id, status, queued_at, finished_at')
      .eq('profile_id', targetProfileId)
      .eq('job_id', jobId)
      .maybeSingle();

    if (appCheckErr) {
      console.error('[telegram/webhook] Error verifying application row creation in Supabase:', appCheckErr);
    } else if (!createdApp) {
      console.error('[telegram/webhook] Warning: resolve_job_confirmation returned "resolved" but no application row found in Supabase for:', {
        profileId: targetProfileId,
        jobId,
      });
    } else {
      console.log('[telegram/webhook] Verified application row created in Supabase:', JSON.stringify(createdApp));
    }

    if (decision === 'yes') {
      await sendFn(chatId, `👍 Got it! Starting application for "${jobTitle}"...`);
    } else {
      await sendFn(chatId, `Skipped "${jobTitle}".`);
    }

    // Auto-advance confirmation queue to prompt next waiting job if any
    await advanceConfirmationQueue(targetProfileId, { supabase, telegramSendFn: sendFn });
  } else if (status === 'ignored_duplicate') {
    console.log('[telegram/webhook] Duplicate confirmation callback ignored for job:', jobId, 'profileId:', targetProfileId);
    if (messageId) {
      await editMarkupFn(chatId, messageId, { inline_keyboard: [] });
    }
  } else if (status === 'ignored_permanent_reject') {
    console.log('[telegram/webhook] Confirmation callback ignored (job already rejected):', jobId, 'profileId:', targetProfileId);
    if (messageId) {
      await editMarkupFn(chatId, messageId, { inline_keyboard: [] });
    }
  } else {
    console.log('[telegram/webhook] Confirmation callback ignored with status:', status, 'profileId:', targetProfileId);
  }
}

/**
 * Generic handler for incoming non-command Telegram messages and user replies.
 *
 * Phase V1-A4 Implementation:
 *   1. Matches sender `chatId` to a user profile via `profiles.telegram_chat_id`.
 *   2. Finds the unconfirmed pending job prompt (`telegram_prompt_sent_at` IS NOT NULL, `resolved_at` IS NULL).
 *   3. If a confirmation is pending and user types text, prompts them to tap Yes/No on the job message.
 *   4. If no pending job exists: logs and ignores silently (03-workflow.md L92; Phase A7 extension point).
 *
 * @param {string|number} chatId - Telegram chat identifier of the sender.
 * @param {object} message - Telegram Message object containing text, attachments, etc.
 * @param {object} [update={}] - Full Telegram Update payload received by the webhook.
 * @param {object} [options={}] - Dependency injection options for testing.
 * @returns {Promise<void>} Resolves when the reply processing completes.
 */
export async function onTelegramReply(chatId, message, _update = {}, options = {}) {
  const text = (message?.text ?? '').trim();
  logToWebhookFile(`MESSAGE RECEIVED - chat_id=${chatId}, text="${text}"`);
  console.log(`[telegram/webhook] Inbound reply received from chat_id=${chatId}: "${text}"`);

  const sendFn = options.telegramSendFn || sendTelegramMessage;
  const supabase = options.supabase || (() => {
    try {
      return createSupabaseAdmin();
    } catch (err) {
      console.error('[telegram/webhook] Failed to initialize Supabase admin client:', err.message);
      return null;
    }
  })();

  if (!supabase) return;

  // 1. Look up profile associated with this Telegram chat ID
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, telegram_chat_id')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();

  if (profileError) {
    console.error('[telegram/webhook] Profile lookup error for chat_id:', chatId, profileError.message);
    return;
  }

  if (!profile) {
    console.log('[telegram/webhook] Inbound reply from unlinked chat_id:', chatId);
    return;
  }

  // 2. Look up the active unconfirmed job prompt for this profile
  const pendingJob = await getPendingConfirmationJob(supabase, profile.id);

  if (pendingJob) {
    // If a job confirmation is pending and user sends a text message, instruct them to tap the button
    console.log('[telegram/webhook] Inbound text received while confirmation is pending for profile:', profile.id);
    await sendFn(
      chatId,
      'Please tap Yes or No on the job message.'
    );
    return;
  }

  // Edge case per 03-workflow.md L92: "Telegram reply arrives with no matching pending job -> ignore silently, log"
  console.log('[telegram/webhook] Inbound reply with no pending confirmation job for profile:', profile.id);
  // Phase A7 will wire Vercel Workflow resume hook and reusable_answers write-through here.
}

/**
 * Vercel Serverless Function Handler for the Telegram Webhook endpoint.
 *
 * Purpose:
 *   Validates request method, parses incoming Telegram updates, routes `/start`
 *   deep links to link `telegram_chat_id` on the user's profile, routes `callback_query`
 *   button interactions, and delegates other messages to `onTelegramReply`.
 *
 * @param {import('http').IncomingMessage & { body?: any, method?: string, headers: Record<string, string> }} req - Inbound HTTP request.
 * @param {import('http').ServerResponse & { status: (code: number) => any, json: (body: any) => any, end: () => any, setHeader: (k: string, v: string) => any }} res - Outbound HTTP response.
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  console.log('WEBHOOK START - body: ' + JSON.stringify(req.body));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  logToWebhookFile(`WEBHOOK CALLED - Method: ${req.method} - Body: ${JSON.stringify(req.body)}`);
  console.log('[telegram/webhook] Inbound POST update:', JSON.stringify(req.body, null, 2));

  let update = req.body;
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update);
    } catch (parseErr) {
      console.error('[telegram/webhook] Failed to parse req.body as JSON:', parseErr.message);
    }
  }

  console.log('Checking for callback_query...');

  const callbackQuery = update?.callback_query;
  const message = update?.message;

  // ── Handle Callback Queries (Inline button clicks) ────────────────────────
  if (callbackQuery) {
    console.log('[telegram/webhook] Routing to onTelegramCallbackQuery:', JSON.stringify(callbackQuery, null, 2));
    await onTelegramCallbackQuery(callbackQuery, update);
    return res.status(200).json({ ok: true });
  }

  // Telegram may send other non-message updates (inline queries, etc.)
  if (!message) {
    console.log('[telegram/webhook] Non-message update received (no message or callback_query), ignoring');
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat?.id;
  const text = (message.text ?? '').trim();

  if (!chatId) {
    return res.status(200).json({ ok: true });
  }

  // ── Handle /start Command (Deep-link linkage) ─────────────────────────────
  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const userId = parts.length > 1 ? parts[1].trim() : null;

    if (!userId) {
      await sendTelegramMessage(
        chatId,
        'Welcome! To link your Telegram account, tap "Link Telegram" inside the OneClickHandshake app.'
      );
      return res.status(200).json({ ok: true });
    }

    let supabase;
    try {
      supabase = createSupabaseAdmin();
    } catch (_err) {
      console.error('[telegram/webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // UPDATE only — never insert/upsert to avoid violating NOT NULL constraints on profiles
    const { data: updated, error: updateError } = await supabase
      .from('profiles')
      .update({ telegram_chat_id: String(chatId) })
      .eq('id', userId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[telegram/webhook] telegram_chat_id update error:', updateError.message);
      await sendTelegramMessage(
        chatId,
        'Something went wrong linking your account. Please try again from the app.'
      );
      return res.status(200).json({ ok: true });
    }

    if (!updated) {
      // No profile row found — user hasn't completed onboarding form yet
      await sendTelegramMessage(
        chatId,
        'No profile found. Please complete the onboarding form in the OneClickHandshake app first, then tap "Link Telegram" again.'
      );
      return res.status(200).json({ ok: true });
    }

    await sendTelegramMessage(
      chatId,
      'Telegram linked! You will receive bot notifications and Q&A prompts here.'
    );

    // Auto-advance confirmation queue in case unprompted jobs were waiting for Telegram linkage
    await advanceConfirmationQueue(userId, { supabase });

    return res.status(200).json({ ok: true });
  }

  // ── Handle Non-command Inbound Replies (Phase A4 / A7 Dispatcher) ───────────
  await onTelegramReply(chatId, message, update);
  return res.status(200).json({ ok: true });
}

