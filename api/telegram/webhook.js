/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram Bot API Update objects.
 *
 * Phase 1 handles one event:
 *   /start <supabase_user_id>
 *     — sent when the user taps the "Link Telegram" deep link in the app.
 *     — sets profiles.telegram_chat_id for the matched profile.
 *     — if no profile exists yet (form not submitted), sends a friendly prompt.
 *
 * Auth   : Telegram sends this from its own servers. No user JWT. Uses the
 *          service-role Supabase client scoped narrowly to the single
 *          profile_id extracted from the /start parameter.
 * Return : Always 200 — Telegram retries on any other status.
 *
 * Phase: Phase 1 — Telegram link-capture (06-implementation.md §5)
 */

import { createClient } from '@supabase/supabase-js';

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN is not set');
    return;
  }
  const telegramApi = `https://api.telegram.org/bot${token}`;
  try {
    await fetch(`${telegramApi}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error('[telegram/webhook] sendMessage error:', err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const update  = req.body;
  const message = update?.message;
  if (!message) return res.status(200).end();

  const chatId = message.chat?.id;
  const text   = (message.text ?? '').trim();

  if (!text.startsWith('/start')) return res.status(200).end();

  const parts  = text.split(' ');
  const userId = parts[1]?.trim();

  if (!userId) {
    await sendMessage(chatId, 'Welcome! To link your Telegram account, tap "Link Telegram" inside the OneClickHandshake app.');
    return res.status(200).end();
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[telegram/webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).end();
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, telegram_chat_id')
    .eq('id', userId)
    .maybeSingle();

  if (fetchError) {
    console.error('[telegram/webhook] profile fetch error:', fetchError.message);
    return res.status(200).end();
  }

  if (!profile) {
    await sendMessage(
      chatId,
      'Please complete and submit your profile in the OneClickHandshake app first, then tap "Link Telegram" again.',
    );
    return res.status(200).end();
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ telegram_chat_id: String(chatId) })
    .eq('id', userId);

  if (updateError) {
    console.error('[telegram/webhook] telegram_chat_id update error:', updateError.message);
    await sendMessage(chatId, 'Something went wrong linking your account. Please try again.');
    return res.status(200).end();
  }

  await sendMessage(chatId, 'Telegram linked! You will receive bot notifications and Q&A prompts here.');
  return res.status(200).end();
}
