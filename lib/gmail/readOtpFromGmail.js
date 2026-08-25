/**
 * readOtpFromGmail(profileId)
 *
 * Fetches and decrypts the stored Gmail refresh token for a given profile,
 * queries the Gmail API for a recent Handshake OTP email, decodes the MIME
 * body, and extracts the 6-digit code.
 *
 * Called inside the `authenticate` workflow step when the bot needs to log
 * in to an existing Handshake account via OTP.
 *
 * Retry / sleep contract:
 *   This function THROWS on every failure. The caller (Vercel Workflow step)
 *   is responsible for catching, sleeping (workflow-level pause), and retrying.
 *   There is NO polling loop inside this function — per 02-trd.md NFR on the
 *   300s Vercel function limit and the AGENTS.md "no bare polling" rule.
 *
 * Required env vars:
 *   GMAIL_TOKEN_ENC_KEY  (or ENCRYPTION_KEY fallback) — AES-256-GCM key
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ⚠️  PLACEHOLDER — verify before shipping:
 *   HANDSHAKE_OTP_SENDER and HANDSHAKE_OTP_SUBJECT below are best-guess values.
 *   Confirm them against a real Handshake OTP email before deploying. Per
 *   AGENTS.md: "check against 03-workflow.md / 05-backend-schema.md first,
 *   ask the user if still unclear."
 */

import { google } from 'googleapis';
import { createSupabaseAdmin } from '../supabase/admin.js';
import { decryptToken } from '../crypto/tokenCipher.js';

// ── OTP email identifiers — VERIFY against a real Handshake OTP email ────────
// These control the Gmail search query. A wrong sender means OTP emails are
// never found. Mark this with a TODO until confirmed.
const HANDSHAKE_OTP_SENDER  = 'portgasdiscordace@gmail.com';     // dev test sender (swap for real Handshake sender in prod)
const HANDSHAKE_OTP_SUBJECT = 'sign in';                         // TODO: confirm subject fragment against real Handshake OTP email
const OTP_SEARCH_WINDOW_SEC = 10 * 60;  // look back 10 minutes
const OTP_REGEX             = /\b(\d{6})\b/;  // Handshake sends a 6-digit code

/**
 * Decode the plain-text body from a Gmail API message object.
 * Walks the MIME part tree looking for text/plain; falls back to the top-level
 * payload body if no multipart structure is found.
 *
 * @param {object} message  — full Gmail API message (format: 'FULL')
 * @returns {string}
 */
function extractPlainTextBody(message) {
  const payload = message.payload ?? {};

  // Multipart: walk parts array for text/plain
  const parts = payload.parts ?? [];
  const textPart = parts.find((p) => p.mimeType === 'text/plain');
  const bodyData = textPart?.body?.data ?? payload.body?.data ?? '';

  if (!bodyData) return '';

  // Gmail uses base64url encoding for message body data
  return Buffer.from(bodyData, 'base64url').toString('utf8');
}

/**
 * Read the most-recent Handshake OTP email and extract the 6-digit code.
 *
 * @param {string} profileId  — Supabase user UUID
 * @returns {Promise<string>}  the 6-digit OTP code string
 * @throws {Error} if no token is found, Gmail API fails, no email is found,
 *                 or no OTP code can be extracted from the email body
 */
export async function readOtpFromGmail(profileId) {
  // ── 1. Fetch encrypted tokens from DB (service-role only) ────────────────
  const supabase = createSupabaseAdmin();

  const { data, error: dbError } = await supabase
    .from('gmail_oauth_tokens')
    .select('refresh_token, access_token, expires_at')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (dbError) {
    throw new Error(`[readOtpFromGmail] DB error for profile ${profileId}: ${dbError.message}`);
  }
  if (!data) {
    throw new Error(
      `[readOtpFromGmail] No Gmail token found for profile ${profileId}. ` +
      'User must complete Gmail OAuth before OTP login can proceed.',
    );
  }

  // ── 2. Decrypt refresh token ──────────────────────────────────────────────
  let refreshToken;
  try {
    refreshToken = decryptToken(data.refresh_token);
  } catch (err) {
    throw new Error(`[readOtpFromGmail] Failed to decrypt refresh token: ${err.message}`);
  }

  // ── 3. Build OAuth2 client with stored credentials ────────────────────────
  const googleClientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!googleClientId || !googleClientSecret) {
    throw new Error('[readOtpFromGmail] GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET not set');
  }

  const oauth2 = new google.auth.OAuth2(googleClientId, googleClientSecret);
  oauth2.setCredentials({
    refresh_token: refreshToken,
    access_token:  data.access_token  ?? undefined,
    expiry_date:   data.expires_at ? new Date(data.expires_at).getTime() : undefined,
  });

  // ── 4. Persist newly refreshed access_token back to DB ────────────────────
  // The 'tokens' event fires whenever the googleapis library auto-refreshes the
  // access token. We write the new value back so the next call is cache-warm.
  oauth2.on('tokens', async (newTokens) => {
    const update = {};
    if (newTokens.access_token)  update.access_token = newTokens.access_token;
    if (newTokens.expiry_date)   update.expires_at   = new Date(newTokens.expiry_date).toISOString();
    if (Object.keys(update).length === 0) return;

    await supabase
      .from('gmail_oauth_tokens')
      .update(update)
      .eq('profile_id', profileId)
      // suppress errors — this is a best-effort cache update; OTP read can
      // still succeed even if the update fails
      .then(({ error: e }) => {
        if (e) console.warn(`[readOtpFromGmail] access_token update failed: ${e.message}`);
      });
  });

  // ── 5. Query Gmail for recent Handshake OTP emails ────────────────────────
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  // 'after:' takes a Unix epoch in seconds — look back OTP_SEARCH_WINDOW_SEC
  const afterEpochSec = Math.floor((Date.now() / 1000) - OTP_SEARCH_WINDOW_SEC);
  const gmailQuery =
    `from:${HANDSHAKE_OTP_SENDER} subject:${HANDSHAKE_OTP_SUBJECT} after:${afterEpochSec}`;

  let listRes;
  try {
    listRes = await gmail.users.messages.list({
      userId: 'me',
      q: gmailQuery,
      maxResults: 5,
    });
  } catch (err) {
    throw new Error(`[readOtpFromGmail] Gmail list API error: ${err.message}`);
  }

  const messages = listRes.data.messages ?? [];
  if (messages.length === 0) {
    throw new Error(
      `[readOtpFromGmail] No OTP email found in the last ${OTP_SEARCH_WINDOW_SEC / 60} minutes ` +
      `(query: "${gmailQuery}"). Caller should sleep and retry.`,
    );
  }

  // ── 6. Read the most-recent matching message ──────────────────────────────
  let msgRes;
  try {
    msgRes = await gmail.users.messages.get({
      userId: 'me',
      id: messages[0].id,
      format: 'FULL',
    });
  } catch (err) {
    throw new Error(`[readOtpFromGmail] Gmail get API error: ${err.message}`);
  }

  // ── 7. Extract 6-digit OTP from plain-text body ───────────────────────────
  const body  = extractPlainTextBody(msgRes.data);
  const match = OTP_REGEX.exec(body);

  if (!match) {
    throw new Error(
      '[readOtpFromGmail] OTP code not found in email body. ' +
      'The email format may have changed — review HANDSHAKE_OTP_SENDER / HANDSHAKE_OTP_SUBJECT ' +
      'and the OTP_REGEX in lib/gmail/readOtpFromGmail.js.',
    );
  }

  return match[1]; // 6-digit string e.g. "482931"
}
