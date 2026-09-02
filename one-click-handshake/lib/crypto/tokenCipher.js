/**
 * AES-256-GCM encrypt / decrypt helpers for Gmail refresh tokens.
 *
 * Wire format (base64-encoded):  iv(12 bytes) ‖ authTag(16 bytes) ‖ ciphertext
 *
 * Key source: GMAIL_TOKEN_ENC_KEY env var — 32-byte hex-encoded string.
 *   Falls back to ENCRYPTION_KEY for backward compatibility with existing
 *   deployments that set that name before this module was introduced.
 *
 * Security contract:
 *  - The plaintext refresh_token is NEVER logged, returned to the client,
 *    or stored anywhere except as the AES-GCM ciphertext.
 *  - decryptToken() throws if the GCM auth-tag fails (tamper / wrong key).
 *  - Rotating the key requires re-encrypting every row in gmail_oauth_tokens
 *    and revoking all existing tokens via the Google OAuth console.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Returns the 32-byte AES key from env.
 * Checks GMAIL_TOKEN_ENC_KEY first, then falls back to ENCRYPTION_KEY.
 * Throws clearly if neither is set or if the length is wrong.
 * @returns {Buffer}
 */
function getKey() {
  const hex = process.env.GMAIL_TOKEN_ENC_KEY || process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      '[tokenCipher] GMAIL_TOKEN_ENC_KEY env var is not set. ' +
      'Set it to a 32-byte (64 hex char) random string.',
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `[tokenCipher] GMAIL_TOKEN_ENC_KEY must be exactly 32 bytes (64 hex chars); ` +
      `got ${key.length} bytes.`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * @param {string} plaintext  — the raw refresh_token string from Google
 * @returns {string}  base64-encoded concatenation of iv(12) ‖ authTag(16) ‖ ciphertext
 */
export function encryptToken(plaintext) {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit nonce — NIST-recommended size for GCM

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // 16-byte GCM authentication tag

  // Single buffer: iv | authTag | ciphertext → base64 (compact, no separators)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64-encoded token produced by encryptToken().
 *
 * @param {string} encoded  — the base64 string stored in gmail_oauth_tokens.refresh_token
 * @returns {string}  plaintext refresh_token
 * @throws if the auth-tag is invalid (wrong key, corrupted ciphertext, or truncated input)
 */
export function decryptToken(encoded) {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');

  if (buf.length < 28) {
    // Minimum: 12 (iv) + 16 (authTag) = 28 bytes before any ciphertext
    throw new Error('[tokenCipher] Encoded token is too short to be a valid AES-GCM payload');
  }

  const iv         = buf.subarray(0, 12);
  const authTag    = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),           // throws ERR_CRYPTO_INVALID_AUTH_TAG if tag fails
  ]).toString('utf8');
}
