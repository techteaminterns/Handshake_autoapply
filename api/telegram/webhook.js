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

import { createSupabaseAdmin } from '../../lib/supabase/admin.js';
import {
  getPendingConfirmationJob,
  resolvePendingConfirmation,
  advanceConfirmationQueue,
} from '../../lib/telegram/jobConfirmation.js';

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
 * Generic handler for incoming non-command Telegram messages and user replies.
 *
 * Phase V1-A4 Implementation:
 *   1. Matches sender `chatId` to a user profile via `profiles.telegram_chat_id`.
 *   2. Finds the unconfirmed pending job prompt (`telegram_prompt_sent_at` IS NOT NULL, `resolved_at` IS NULL).
 *   3. If no pending job exists: logs and ignores silently (03-workflow.md L92; Phase A7 extension point).
 *   4. Normalizes user reply into 'yes' or 'no':
 *      - Unrecognized replies prompt the user to reply YES or NO without closing the pending prompt.
 *   5. Calls `resolvePendingConfirmation` atomic RPC to create QUEUED/REJECTED application row and resolve prompt.
 *   6. Acknowledges user decision and automatically advances the confirmation queue to prompt the next unprompted job.
 *
 * @param {string|number} chatId - Telegram chat identifier of the sender.
 * @param {object} message - Telegram Message object containing text, attachments, etc.
 * @param {object} [update={}] - Full Telegram Update payload received by the webhook.
 * @returns {Promise<void>} Resolves when the reply processing completes.
 */
export async function onTelegramReply(chatId, message, _update = {}, options = {}) {
  const text = (message?.text ?? '').trim();
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

  if (!pendingJob) {
    // Edge case per 03-workflow.md L92: "Telegram reply arrives with no matching pending job -> ignore silently, log"
    console.log('[telegram/webhook] Inbound reply with no pending confirmation job for profile:', profile.id);
    // Phase A7 will wire Vercel Workflow resume hook and reusable_answers write-through here.
    return;
  }

  // 3. Parse yes / no decision from message text
  const normalized = text.toLowerCase();
  const YES_REGEX = /^(yes|y|yeah|yep|👍|apply)\b/i;
  const NO_REGEX = /^(no|n|nope|skip|👎)\b/i;

  let decision = null;
  if (YES_REGEX.test(normalized)) {
    decision = 'yes';
  } else if (NO_REGEX.test(normalized)) {
    decision = 'no';
  }

  if (!decision) {
    console.log('[telegram/webhook] Unrecognized confirmation reply from chat_id:', chatId, `"${text}"`);
    await sendFn(
      chatId,
      'Please reply YES to queue this application or NO to skip.'
    );
    return;
  }

  // 4. Atomically resolve the pending confirmation
  const { status, error } = await resolvePendingConfirmation(
    profile.id,
    pendingJob.id,
    decision,
    { supabase }
  );

  if (error) {
    console.error('[telegram/webhook] Error resolving job confirmation:', error);
    return;
  }

  if (status === 'resolved') {
    if (decision === 'yes') {
      await sendFn(
        chatId,
        `Got it! Queued application for "${pendingJob.title}".`
      );
    } else {
      await sendFn(
        chatId,
        `Skipped "${pendingJob.title}".`
      );
    }

    // Auto-advance confirmation queue to prompt next waiting job if any
    await advanceConfirmationQueue(profile.id, { supabase, telegramSendFn: sendFn });
  } else if (status === 'ignored_duplicate') {
    console.log('[telegram/webhook] Duplicate confirmation reply ignored for job:', pendingJob.id);
  } else if (status === 'ignored_permanent_reject') {
    console.log('[telegram/webhook] Confirmation reply ignored (job already rejected):', pendingJob.id);
  } else {
    console.log('[telegram/webhook] Confirmation reply ignored with status:', status);
  }
}

/**
 * Vercel Serverless Function Handler for the Telegram Webhook endpoint.
 *
 * Purpose:
 *   Validates request method, parses incoming Telegram updates, routes `/start`
 *   deep links to link `telegram_chat_id` on the user's profile, and delegates
 *   other messages to `onTelegramReply`.
 *
 * @param {import('http').IncomingMessage & { body?: any, method?: string, headers: Record<string, string> }} req - Inbound HTTP request.
 * @param {import('http').ServerResponse & { status: (code: number) => any, json: (body: any) => any, end: () => any, setHeader: (k: string, v: string) => any }} res - Outbound HTTP response.
 * @returns {Promise<void>}
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const update = req.body;
  const message = update?.message;

  // Telegram may send non-message updates (inline queries, callback queries, etc.)
  if (!message) {
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

