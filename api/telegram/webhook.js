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

import { createClient } from '@supabase/supabase-js';

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
 * Purpose:
 *   Provides a decoupled module-level receiver for conversational responses. In Phase A7,
 *   this will be wired into Vercel Workflow pause/resume hooks (resolving questions asked
 *   during Handshake application runs) and persisting new answers to `reusable_answers`.
 *
 * @param {string|number} chatId - Telegram chat identifier of the sender.
 * @param {object} message - Telegram Message object containing text, attachments, etc.
 * @param {object} [update={}] - Full Telegram Update payload received by the webhook.
 * @returns {Promise<void>} Resolves when the reply processing completes.
 */
export async function onTelegramReply(chatId, message, update = {}) {
  const text = (message?.text ?? '').trim();
  console.log(`[telegram/webhook] Inbound reply received from chat_id=${chatId}: "${text}"`);

  // Phase A7 will wire Vercel Workflow resume hook and reusable_answers write-through here.
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

    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error('[telegram/webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

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
    return res.status(200).json({ ok: true });
  }

  // ── Handle Non-command Inbound Replies (Phase A7 Dispatcher) ───────────────
  await onTelegramReply(chatId, message, update);
  return res.status(200).json({ ok: true });
}
