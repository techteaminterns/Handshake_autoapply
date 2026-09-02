/**
 * api/whatsapp/status.js
 *
 * Checks current WhatsApp connection and QR linking status for a user.
 */

import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../../lib/supabase/admin.js';
import { getWhatsAppSessionState } from '../../lib/whatsapp/client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let token = null;
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query?.access_token) {
    token = req.query.access_token;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  let userId = req.body?.user_id || req.query?.user_id;

  if (token && (!userId || !supabaseAnonKey)) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      userId = user.id;
    }
  }

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: missing user identifier' });
  }

  try {
    const adminSupabase = createSupabaseAdmin();
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('whatsapp_phone, phone')
      .eq('id', userId)
      .maybeSingle();

    const state = getWhatsAppSessionState(userId);
    const phone = profile?.whatsapp_phone || state.phone || null;
    const isConnected = Boolean(profile?.whatsapp_phone) || state.status === 'connected';

    return res.status(200).json({
      ok: true,
      profile_id: userId,
      status: isConnected ? 'connected' : state.status || 'unlinked',
      phone,
      qr: isConnected ? null : state.qr || null,
      qr_data_url: isConnected ? null : state.qrDataUrl || null,
    });
  } catch (err) {
    console.error('[api/whatsapp/status] Error checking WhatsApp status:', err.message || err);
    return res.status(500).json({ error: err.message || 'Status check failed' });
  }
}
