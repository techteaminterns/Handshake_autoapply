/**
 * HMAC-SHA256 state token helpers for OAuth CSRF protection.
 *
 * The `state` param Google echoes back in the callback is:
 *   base64url( JSON({ profileId, nonce, exp }) ) + "." + HMAC signature
 *
 * Key source: OAUTH_STATE_SECRET env var — 32-byte hex string.
 *
 * TTL: 10 minutes.  Tokens older than that are rejected in verifyState().
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret() {
  const hex = process.env.OAUTH_STATE_SECRET;
  if (!hex) throw new Error('[oauthState] OAUTH_STATE_SECRET env var is not set');
  return Buffer.from(hex, 'hex');
}

function sign(payload) {
  return createHmac('sha256', getSecret())
    .update(payload)
    .digest('base64url');
}

/**
 * Create a signed, time-limited state token encoding the profileId.
 * @param {string} profileId  — Supabase user UUID
 * @returns {string}  URL-safe string to use as the OAuth `state` param
 */
export function createState(profileId) {
  const payload = Buffer.from(
    JSON.stringify({
      profileId,
      nonce: randomBytes(8).toString('hex'),
      exp: Date.now() + STATE_TTL_MS,
    }),
  ).toString('base64url');

  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/**
 * Verify a state token and return the embedded profileId.
 * Throws if the signature is invalid, the token is expired, or malformed.
 * @param {string} state
 * @returns {{ profileId: string }}
 */
export function verifyState(state) {
  if (!state || typeof state !== 'string') {
    throw new Error('[oauthState] Missing state param');
  }

  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new Error('[oauthState] Malformed state token');

  const payload = state.slice(0, dotIdx);
  const receivedSig = state.slice(dotIdx + 1);

  // Constant-time comparison to prevent timing attacks
  const expectedSig = sign(payload);
  const a = Buffer.from(receivedSig,  'base64url');
  const b = Buffer.from(expectedSig, 'base64url');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('[oauthState] State signature invalid');
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('[oauthState] State payload is not valid JSON');
  }

  if (!parsed.profileId || !parsed.exp) {
    throw new Error('[oauthState] State payload missing required fields');
  }

  if (Date.now() > parsed.exp) {
    throw new Error('[oauthState] State token has expired');
  }

  return { profileId: parsed.profileId };
}
