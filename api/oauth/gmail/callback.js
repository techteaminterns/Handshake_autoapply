/**
 * GET /api/oauth/gmail/callback
 *
 * Google redirect target after Gmail readonly consent.
 * Exchanges auth code for tokens, encrypts refresh_token with AES-256-GCM,
 * upserts encrypted token into gmail_oauth_tokens via service-role.
 *
 * Security: refresh_token is NEVER logged, returned, or exposed to the client.
 *
 * Phase: Phase 1 — Gmail OAuth callback (06-implementation.md §6)
 */

import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function callbackUrl() {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  return `${base}/api/oauth/gmail/callback`;
}

function encryptToken(plaintext, encryptionKeyHex) {
  const key = Buffer.from(encryptionKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code, state: userId, error: oauthError } = req.query ?? {};

  if (oauthError) {
    console.warn('[gmail/callback] OAuth denied:', oauthError);
    return res.status(200).send(errorHtml('Google OAuth was cancelled or denied.'));
  }
  if (!code || !userId) {
    return res.status(400).send(errorHtml('Missing required parameters.'));
  }
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!encryptionKey) {
    console.error('[gmail/callback] ENCRYPTION_KEY not set');
    return res.status(500).send(errorHtml('Server misconfiguration.'));
  }
  if (!googleClientId || !googleClientSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[gmail/callback] Missing required environment variables');
    return res.status(500).send(errorHtml('Server misconfiguration.'));
  }

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
    console.error('[gmail/callback] token exchange failed:', err.message);
    return res.status(500).send(errorHtml('Token exchange with Google failed.'));
  }

  if (!tokens.refresh_token) {
    return res.status(400).send(errorHtml(
      'Google did not return a refresh token. Disconnect the app in Google Account settings and try again.',
    ));
  }

  const encryptedRefreshToken = encryptToken(tokens.refresh_token, encryptionKey);

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { error: upsertError } = await supabase
    .from('gmail_oauth_tokens')
    .upsert(
      {
        profile_id:    userId,
        refresh_token: encryptedRefreshToken,
        access_token:  tokens.access_token ?? null,
        scope:         tokens.scope ?? 'https://www.googleapis.com/auth/gmail.readonly',
        expires_at:    tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      },
      { onConflict: 'profile_id' },
    );

  if (upsertError) {
    console.error('[gmail/callback] upsert error:', upsertError.message);
    return res.status(500).send(errorHtml('Failed to save your Gmail token.'));
  }

  return res.status(200).send(SUCCESS_HTML);
}
