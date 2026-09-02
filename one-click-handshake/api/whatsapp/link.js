/**
 * api/whatsapp/link.js
 *
 * Endpoint to initiate WhatsApp QR linking for a user.
 * Initializes Baileys client and returns the QR code string and base64 PNG data URL.
 */

import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../../lib/supabase/admin.js';
import { initWhatsApp, getWhatsAppSessionState } from '../../lib/whatsapp/client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Authenticate user
  let token = null;
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query?.access_token) {
    token = req.query.access_token;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let userId = req.body?.user_id || req.query?.user_id;

  if (token) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!authError && user?.id) {
      userId = user.id;
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: missing valid authentication token' });
  }

  try {
    const adminSupabase = createSupabaseAdmin();

    // Check if already linked in profiles
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('whatsapp_phone')
      .eq('id', userId)
      .maybeSingle();

    // Initialize Baileys client (triggers QR generation or connects existing session)
    const initResult = await initWhatsApp(userId, {
      supabase: adminSupabase,
      printQRTerminal: true,
      forceNew: req.query?.refresh === 'true' || req.body?.refresh === true,
    });

    const state = getWhatsAppSessionState(userId);

    return res.status(200).json({
      ok: true,
      profile_id: userId,
      status: profile?.whatsapp_phone ? 'connected' : state.status || initResult.status,
      phone: profile?.whatsapp_phone || state.phone || null,
      qr: state.qr || null,
      qr_data_url: state.qrDataUrl || null,
    });
  } catch (err) {
    console.error('[api/whatsapp/link] Error initializing WhatsApp link:', err.message || err);
    return res.status(500).json({ error: err.message || 'Failed to initialize WhatsApp linking' });
  }
}
