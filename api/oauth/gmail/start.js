/**
 * GET /api/oauth/gmail/start
 *
 * Begins the Google OAuth 2.0 consent flow for Gmail readonly access.
 * Only valid for users whose profile has has_existing_handshake_account = true.
 *
 * Auth   : Bearer JWT in Authorization header, OR access_token query param
 *          (query-param form used when opened in system browser from the RN app).
 * Scope  : gmail.readonly — read-only, used only to read the Handshake OTP.
 * State  : user.id encoded in OAuth state param so callback links token to profile.
 *
 * Phase: Phase 1 — Gmail OAuth start (06-implementation.md §6)
 */

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

function callbackUrl() {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  return `${base}/api/oauth/gmail/callback`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query?.access_token ?? '');

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[gmail/start] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('has_existing_handshake_account')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return res.status(400).json({ error: 'Profile not found. Submit the onboarding form first.' });
  }
  if (!profile.has_existing_handshake_account) {
    return res.status(400).json({
      error: 'Gmail OAuth is only required for users with an existing Handshake account.',
    });
  }

  if (!googleClientId || !googleClientSecret) {
    console.error('[gmail/start] Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    callbackUrl(),
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
    state: user.id,
  });

  return res.redirect(302, url);
}
