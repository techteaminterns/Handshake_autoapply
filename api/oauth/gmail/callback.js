/**
 * GET /api/oauth/gmail/callback
 *
 * Google redirect target after Gmail readonly consent.
 *
 * Flow:
 *   1. Verify HMAC-SHA256 `state` param (CSRF guard, 10-min TTL).
 *   2. Exchange auth `code` for tokens via googleapis OAuth2 client.
 *   3. Encrypt refresh_token with AES-256-GCM (GMAIL_TOKEN_ENC_KEY).
 *   4. Upsert encrypted token into gmail_oauth_tokens via service-role.
 *   5. Return a success HTML page the user closes to return to the app.
 *
 * Security:
 *   - refresh_token is NEVER logged, returned, or exposed to the client.
 *   - state is verified with timingSafeEqual before any DB write.
 *   - All DB writes use the service role, scoped to the single profile_id
 *     extracted from the verified state token.
 *
 * Required env vars:
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   OAUTH_STATE_SECRET   (32-byte hex — HMAC key for state verification)
 *   GMAIL_TOKEN_ENC_KEY  (32-byte hex — AES-256-GCM key for refresh_token)
 *     Falls back to ENCRYPTION_KEY for backward compatibility.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
 *
 * Spec: 05-backend-schema.md § GET /api/oauth/gmail/callback
 */

import { google } from 'googleapis';
import { createSupabaseAdmin } from '../../../lib/supabase/admin.js';
import { encryptToken } from '../../../lib/crypto/tokenCipher.js';
import { verifyState } from '../../../lib/oauth/state.js';

function callbackUrl() {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  return `${base}/api/oauth/gmail/callback`;
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gmail Connected</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8fafc}
.card{text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
h2{color:#16a34a;margin-bottom:8px}p{color:#555}</style></head>
<body><div class="card"><h2>Gmail connected!</h2><p>You can close this tab and return to the OneClickHandshake app.</p></div></body></html>`;

const errorHtml = (msg) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8fafc}
.card{text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08)}
h2{color:#dc2626;margin-bottom:8px}p{color:#555}</style></head>
<body><div class="card"><h2>Connection failed</h2><p>${msg}</p><p>Close this tab and try again from the app.</p></div></body></html>`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code, state, error: oauthError } = req.query ?? {};

  // ── 1. Handle Google-side errors (user denied, etc.) ─────────────────────
  if (oauthError) {
    console.warn('[gmail/callback] OAuth denied by user or Google:', oauthError);
    return res.status(200).send(errorHtml('Google OAuth was cancelled or denied.'));
  }
  if (!code || !state) {
    return res.status(400).send(errorHtml('Missing required parameters (code or state).'));
  }

  // ── 2. Verify HMAC-signed state token (CSRF protection) ───────────────────
  let profileId;
  try {
    ({ profileId } = verifyState(state));
  } catch (err) {
    console.warn('[gmail/callback] State verification failed:', err.message);
    return res.status(400).send(errorHtml('Invalid or expired authorization request.'));
  }

  // ── 3. Validate server config ─────────────────────────────────────────────
  const googleClientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!googleClientId || !googleClientSecret) {
    console.error('[gmail/callback] Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET');
    return res.status(500).send(errorHtml('Server misconfiguration.'));
  }

  // ── 4. Exchange auth code for tokens ─────────────────────────────────────
  const oauth2Client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    callbackUrl(),
  );

  let tokens;
  try {
    const { tokens: t } = await oauth2Client.getToken(code);
    tokens = t;
  } catch (err) {
    console.error('[gmail/callback] Token exchange with Google failed:', err.message);
    return res.status(500).send(errorHtml('Token exchange with Google failed.'));
  }

  // ── 5. Guard: refresh_token must be present ───────────────────────────────
  // This is absent if prompt=consent was not set on the start route, or if the
  // user has a cached grant that was not revoked. Inform them to re-authorise.
  if (!tokens.refresh_token) {
    console.warn(`[gmail/callback] No refresh_token in Google response for profile ${profileId}. ` +
      'User may need to revoke and re-grant access.');
    return res.status(400).send(errorHtml(
      'Google did not return a refresh token. ' +
      'Go to myaccount.google.com/permissions, revoke OneClickHandshake access, then try again.',
    ));
  }

  // ── 6. Encrypt refresh_token with AES-256-GCM ────────────────────────────
  // GMAIL_TOKEN_ENC_KEY (or ENCRYPTION_KEY fallback) must be set.
  // encryptToken() throws with a clear message if the key is missing/invalid.
  let encryptedRefreshToken;
  try {
    encryptedRefreshToken = encryptToken(tokens.refresh_token);
  } catch (err) {
    console.error('[gmail/callback] Token encryption failed:', err.message);
    return res.status(500).send(errorHtml('Server misconfiguration.'));
  }

  // ── 7. Upsert into gmail_oauth_tokens (service-role) ─────────────────────
  // Service role bypasses RLS intentionally: the callback has no user session.
  // Scoped narrowly to the single profileId from the verified state token.
  let supabase;
  try {
    supabase = createSupabaseAdmin();
  } catch (err) {
    console.error('[gmail/callback] Supabase admin init failed:', err.message);
    return res.status(500).send(errorHtml('Server misconfiguration.'));
  }

  const { error: upsertError } = await supabase
    .from('gmail_oauth_tokens')
    .upsert(
      {
        profile_id:    profileId,
        refresh_token: encryptedRefreshToken,          // AES-256-GCM ciphertext
        access_token:  tokens.access_token  ?? null,  // short-lived, plaintext OK
        scope:         tokens.scope ?? 'https://www.googleapis.com/auth/gmail.readonly',
        expires_at:    tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
      },
      { onConflict: 'profile_id' },
    );

  if (upsertError) {
    console.error('[gmail/callback] gmail_oauth_tokens upsert error:', upsertError.message);
    return res.status(500).send(errorHtml('Failed to save your Gmail token. Please try again.'));
  }

  console.log('[gmail/callback] Gmail token stored successfully.');
  return res.status(200).send(SUCCESS_HTML);
}
