/**
 * GET /api/oauth/gmail/start
 *
 * Begins the Google OAuth 2.0 consent flow for Gmail readonly access.
 * Offered unconditionally to all users with a saved profile — not gated
 * behind has_existing_handshake_account (per Phase A4 spec).
 *
 * Auth   : Bearer JWT in Authorization header, OR access_token query param
 *          (query-param form used when opening in system browser from the RN app).
 * Scope  : gmail.readonly — read-only; used only to extract the Handshake OTP
 *          email. We never read, store, or forward any other email content.
 * State  : HMAC-SHA256 signed token containing { profileId, nonce, exp }.
 *          Verified in the callback to prevent CSRF attacks.
 *          TTL: 10 minutes (enforced in lib/oauth/state.js).
 *
 * Required env vars:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   OAUTH_STATE_SECRET  (32-byte hex string — for HMAC state signing)
 *   SUPABASE_URL, SUPABASE_ANON_KEY (or EXPO_PUBLIC_* / NEXT_PUBLIC_* variants)
 *
 * Spec: 05-backend-schema.md § GET /api/oauth/gmail/start
 */

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { createState } from '../../../lib/oauth/state.js';

function callbackUrl() {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  return `${base}/api/oauth/gmail/callback`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Resolve Bearer token ───────────────────────────────────────────────
  // Accepts header form (Bearer <token>) or query-param form (?access_token=...)
  // because the RN app opens this URL in the system browser, which cannot set
  // Authorization headers on the redirect.
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req.query?.access_token ?? '');

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // ── 2. Validate required env vars ─────────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.EXPO_PUBLIC_SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
    || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const googleClientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[gmail/start] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  if (!googleClientId || !googleClientSecret) {
    console.error('[gmail/start] Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  // OAUTH_STATE_SECRET absence is caught inside createState() with a clear error.

  // ── 3. Verify Supabase session + profile exists ───────────────────────────
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Confirm the profile row exists (required before any OAuth grant).
  // Not gating on has_existing_handshake_account — Gmail OAuth is offered to
  // all users per Phase A4 spec.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return res.status(400).json({
      error: 'Profile not found. Complete the onboarding form before connecting Gmail.',
    });
  }

  // ── 4. Build HMAC-SHA256 signed state token (CSRF protection) ────────────
  let state;
  try {
    state = createState(user.id);
  } catch (err) {
    console.error('[gmail/start] createState failed:', err.message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── 5. Build and redirect to Google consent URL ───────────────────────────
  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    callbackUrl(),
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',  // always show consent screen to guarantee refresh_token is returned
    state,
  });

  return res.redirect(302, url);
}
