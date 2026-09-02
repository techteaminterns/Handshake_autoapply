/**
 * lib/whatsapp/client.js
 *
 * WhatsApp Baileys integration client:
 * 1. Initializes Baileys WASocket with multi-file auth & Supabase session sync.
 * 2. Manages QR code generation, terminal display, and web QR modal integration.
 * 3. Handles connection lifecycle (QR, open, reconnect, close) and extracts phone numbers.
 * 4. Listens to inbound message events with deep message unwrapping & detailed logging.
 * 5. Provides outbound WhatsApp message sending utility.
 * 6. Validates stored session JSON and provides --force-relink / clean QR generation.
 */

import fs from 'fs';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { createSupabaseAdmin } from '../supabase/admin.js';

// In-memory registry of active WhatsApp socket instances and session states
const activeClients = new Map(); // profileId -> WASocket
const sessionStates = new Map(); // profileId -> { status, qr, qrDataUrl, phone, updatedAt }
const messageListeners = new Map(); // profileId -> Set<Function>

/**
 * Formats a phone number or JID into a valid WhatsApp JID (e.g. 14155552671@s.whatsapp.net).
 *
 * @param {string} phoneOrJid
 * @returns {string}
 */
export function formatJid(phoneOrJid) {
  if (!phoneOrJid) return '';
  const str = String(phoneOrJid).trim();
  if (str.includes('@s.whatsapp.net') || str.includes('@g.us')) {
    return str;
  }
  // Strip non-digit characters (+, -, space, parentheses)
  const cleanDigits = str.replace(/[^0-9]/g, '');
  return `${cleanDigits}@s.whatsapp.net`;
}

/**
 * Unwraps nested message structures (ephemeral, viewOnce, document captions).
 *
 * @param {object} msgContent
 * @returns {object|null}
 */
export function unwrapMessage(msgContent) {
  if (!msgContent || typeof msgContent !== 'object') return null;
  if (msgContent.ephemeralMessage?.message) {
    return unwrapMessage(msgContent.ephemeralMessage.message);
  }
  if (msgContent.viewOnceMessage?.message) {
    return unwrapMessage(msgContent.viewOnceMessage.message);
  }
  if (msgContent.viewOnceMessageV2?.message) {
    return unwrapMessage(msgContent.viewOnceMessageV2.message);
  }
  if (msgContent.documentWithCaptionMessage?.message) {
    return unwrapMessage(msgContent.documentWithCaptionMessage.message);
  }
  return msgContent;
}

/**
 * Extracts readable text content from a Baileys message object.
 *
 * @param {object} msg
 * @returns {string}
 */
export function extractMessageText(msg) {
  const content = unwrapMessage(msg?.message);
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    content.templateButtonReplyMessage?.selectedId ||
    content.listResponseMessage?.title ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

/**
 * Identifies the message type name (e.g. conversation, extendedTextMessage, imageMessage).
 *
 * @param {object} msg
 * @returns {string}
 */
export function getMessageType(msg) {
  const content = unwrapMessage(msg?.message);
  if (!content) return 'empty';
  const keys = Object.keys(content);
  return keys.find((k) => k !== 'messageContextInfo') || keys[0] || 'unknown';
}

/**
 * Validates whether a stored Baileys session JSON is genuine and uncorrupted.
 *
 * @param {object} sessionJson
 * @returns {boolean}
 */
export function isSessionValid(sessionJson) {
  if (!sessionJson || typeof sessionJson !== 'object') return false;
  const creds = sessionJson.creds || sessionJson;
  // Must contain valid user identity and key structures
  if (!creds.me || !creds.me.id || typeof creds.me.id !== 'string') return false;
  if (!creds.noiseKey || !creds.signedIdentityKey || !creds.registrationId) return false;
  // Reject mock placeholders
  if (creds.noiseKey.private === 'mock_priv_key' || creds.signedIdentityKey.private === 'mock_id_priv') {
    return false;
  }
  return true;
}

/**
 * Returns the local session directory path for a profile.
 *
 * @param {string} profileId
 * @returns {string}
 */
export function getSessionDir(profileId) {
  const baseDir = path.resolve(process.cwd(), 'sessions', `whatsapp_${profileId}`);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

/**
 * Clears local session files on disk and in Supabase to force fresh QR linking.
 *
 * @param {string} profileId
 * @param {import('@supabase/supabase-js').SupabaseClient} [supabase]
 */
export async function clearWhatsAppSession(profileId, supabase) {
  await disconnectWhatsApp(profileId);

  const sessionDir = getSessionDir(profileId);
  if (fs.existsSync(sessionDir)) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[whatsapp/client] Cleared local session directory for profile ${profileId}`);
    } catch (rmErr) {
      console.warn(`[whatsapp/client] Error clearing session directory:`, rmErr.message);
    }
  }

  const client = supabase || createSupabaseAdmin();
  try {
    await client
      .from('profiles')
      .update({ whatsapp_session: null })
      .eq('id', profileId);
    console.log(`[whatsapp/client] Cleared whatsapp_session in Supabase for profile ${profileId}`);
  } catch (dbErr) {
    console.warn(`[whatsapp/client] Error clearing whatsapp_session in Supabase:`, dbErr.message);
  }
}

/**
 * Hydrates local session directory from Supabase `profiles.whatsapp_session` if valid.
 *
 * @param {string} profileId
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function hydrateSessionFromSupabase(profileId, supabase) {
  try {
    const client = supabase || createSupabaseAdmin();
    const { data: profile } = await client
      .from('profiles')
      .select('whatsapp_session')
      .eq('id', profileId)
      .maybeSingle();

    const sessionData = profile?.whatsapp_session;
    if (sessionData && typeof sessionData === 'object') {
      if (!isSessionValid(sessionData)) {
        console.warn(`[whatsapp/client] Stored session in Supabase for profile ${profileId} is invalid/stale. Wiping to force fresh QR...`);
        await clearWhatsAppSession(profileId, client);
        return;
      }

      const sessionDir = getSessionDir(profileId);
      const credsPath = path.join(sessionDir, 'creds.json');
      if (!fs.existsSync(credsPath)) {
        const credsToSave = sessionData.creds || sessionData;
        fs.writeFileSync(credsPath, JSON.stringify(credsToSave, null, 2), 'utf8');
        console.log(`[whatsapp/client] Hydrated valid creds.json from Supabase for profile ${profileId}`);
      }
    }
  } catch (err) {
    console.warn(`[whatsapp/client] Failed to hydrate session from Supabase for profile ${profileId}:`, err.message);
  }
}

/**
 * Syncs local session credentials to Supabase `profiles.whatsapp_session`.
 *
 * @param {string} profileId
 * @param {string} phone
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function syncSessionToSupabase(profileId, phone, supabase) {
  try {
    const client = supabase || createSupabaseAdmin();
    const sessionDir = getSessionDir(profileId);
    const credsPath = path.join(sessionDir, 'creds.json');

    let sessionJson = null;
    if (fs.existsSync(credsPath)) {
      try {
        sessionJson = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      } catch {
        sessionJson = null;
      }
    }

    const updates = {};
    if (phone) updates.whatsapp_phone = phone;
    if (sessionJson) updates.whatsapp_session = sessionJson;

    if (Object.keys(updates).length > 0) {
      const { error } = await client
        .from('profiles')
        .update(updates)
        .eq('id', profileId);

      if (error) {
        console.error(`[whatsapp/client] Error syncing session to Supabase for ${profileId}:`, error.message);
      } else {
        console.log(`[whatsapp/client] ✅ Successfully synced WhatsApp session to Supabase for profile ${profileId} (phone: +${phone})`);
      }
    }
  } catch (err) {
    console.warn(`[whatsapp/client] syncSessionToSupabase exception for ${profileId}:`, err.message);
  }
}

/**
 * Returns the current session state for a profile.
 *
 * @param {string} profileId
 * @returns {{ status: 'unlinked'|'qr_ready'|'connecting'|'connected'|'disconnected', qr?: string, qrDataUrl?: string, phone?: string, updatedAt?: string }}
 */
export function getWhatsAppSessionState(profileId) {
  if (sessionStates.has(profileId)) {
    return sessionStates.get(profileId);
  }
  return { status: 'unlinked' };
}

/**
 * Registers an inbound message listener for a profile.
 *
 * @param {string} profileId
 * @param {Function} listenerFn - (msg, text, senderJid) => void
 * @returns {() => void} unsubscribe function
 */
export function registerMessageListener(profileId, listenerFn) {
  if (!messageListeners.has(profileId)) {
    messageListeners.set(profileId, new Set());
  }
  messageListeners.get(profileId).add(listenerFn);
  return () => {
    messageListeners.get(profileId)?.delete(listenerFn);
  };
}

/**
 * Initializes or returns an active Baileys WhatsApp client for a user profile.
 *
 * @param {string} profileId - Supabase profile UUID
 * @param {object} [options={}]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 * @param {boolean} [options.printQRTerminal=true] - Whether to print ASCII QR in console
 * @param {boolean} [options.forceRelink=false] - Ignore stored session and force fresh QR
 * @param {Function} [options.onQR] - Callback when QR is ready (qr, qrDataUrl) => void
 * @param {Function} [options.onConnected] - Callback when connected ({ jid, phone }) => void
 * @param {Function} [options.onMessage] - Callback on inbound message (msg, text, senderJid) => void
 * @param {boolean} [options.forceNew=false] - Force recreate socket
 * @returns {Promise<{ sock: import('@whiskeysockets/baileys').WASocket, status: string, qr?: string, qrDataUrl?: string }>}
 */
export async function initWhatsApp(profileId, options = {}) {
  if (!profileId) {
    throw new Error('[whatsapp/client] profileId is required to initialize WhatsApp');
  }

  const supabase = options.supabase || createSupabaseAdmin();

  // Handle forceRelink: wipe session storage and force new QR
  if (options.forceRelink) {
    console.log(`[whatsapp/client] 🔄 Force relink requested for profile ${profileId}. Wiping session to force fresh QR...`);
    await clearWhatsAppSession(profileId, supabase);
  } else {
    // Check if existing active client is connected
    if (!options.forceNew && activeClients.has(profileId)) {
      const existingSock = activeClients.get(profileId);
      const state = sessionStates.get(profileId) || { status: 'connected' };
      if (state.status === 'connected') {
        return { sock: existingSock, ...state };
      }
    }

    // Hydrate local session from Supabase if valid
    await hydrateSessionFromSupabase(profileId, supabase);

    // Validate local credentials on disk
    const sessionDir = getSessionDir(profileId);
    const credsPath = path.join(sessionDir, 'creds.json');
    if (fs.existsSync(credsPath)) {
      try {
        const localCreds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (!isSessionValid(localCreds)) {
          console.warn(`[whatsapp/client] Local creds.json for profile ${profileId} is invalid/stale. Wiping...`);
          await clearWhatsAppSession(profileId, supabase);
        }
      } catch {
        await clearWhatsAppSession(profileId, supabase);
      }
    }
  }

  const sessionDir = getSessionDir(profileId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
    version: [2, 3000, 1015901307],
    isLatest: true,
  }));

  console.log(`[whatsapp/client] Initializing Baileys client for profile ${profileId} (version: ${version.join('.')}, isLatest: ${isLatest})`);

  sessionStates.set(profileId, {
    status: 'connecting',
    updatedAt: new Date().toISOString(),
  });

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    browser: ['OneClickHandshake', 'Desktop', '1.0.0'],
    syncFullHistory: false,
    defaultQueryTimeoutMs: 60000,
  });

  activeClients.set(profileId, sock);

  // 1. Listen for credential updates & persist
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    const currentState = sessionStates.get(profileId) || {};
    if (currentState.phone) {
      await syncSessionToSupabase(profileId, currentState.phone, supabase);
    }
  });

  // 2. Connection updates (QR, open, close)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[whatsapp/client] 📱 Fresh QR code generated for profile ${profileId}`);

      let qrDataUrl = '';
      try {
        qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
      } catch (qrErr) {
        console.warn('[whatsapp/client] Failed to generate QR data URL:', qrErr.message);
      }

      sessionStates.set(profileId, {
        status: 'qr_ready',
        qr,
        qrDataUrl,
        updatedAt: new Date().toISOString(),
      });

      if (options.printQRTerminal !== false) {
        console.log('\n┌─────────────────────────────────────────────────────────────┐');
        console.log('│  📱 SCAN THIS QR CODE WITH WHATSAPP ON YOUR PHONE:          │');
        console.log('│  1. Open WhatsApp on your phone                             │');
        console.log('│  2. Tap Settings > Linked Devices > Link a Device           │');
        console.log('│  3. Point your camera at the QR code below:                 │');
        console.log('└─────────────────────────────────────────────────────────────┘\n');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('\n⏳ Waiting for you to scan the QR code...\n');
      }

      if (options.onQR) {
        try {
          options.onQR(qr, qrDataUrl);
        } catch (onQrErr) {
          console.warn('[whatsapp/client] onQR callback error:', onQrErr.message);
        }
      }
    }

    if (connection === 'open') {
      const jid = sock.user?.id || '';
      const phone = jid.split(':')[0].replace(/[^0-9]/g, '');

      console.log(`\n================================================================`);
      console.log(`  ✅ WHATSAPP LINKED SUCCESSFULLY!                              `);
      console.log(`  Connected Phone: +${phone} (JID: ${jid})                      `);
      console.log(`================================================================\n`);

      sessionStates.set(profileId, {
        status: 'connected',
        phone,
        jid,
        updatedAt: new Date().toISOString(),
      });

      // Save credentials & phone to Supabase profiles table
      await syncSessionToSupabase(profileId, phone, supabase);

      if (options.onConnected) {
        try {
          options.onConnected({ jid, phone });
        } catch (onConnErr) {
          console.warn('[whatsapp/client] onConnected callback error:', onConnErr.message);
        }
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMsg = lastDisconnect?.error?.message || '';
      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;

      console.log(`[whatsapp/client] Connection closed for profile ${profileId}. Code: ${statusCode} (${errorMsg})`);

      if (isLoggedOut) {
        console.warn(`[whatsapp/client] ⚠️ Stale / logged-out session detected. Clearing credentials to prevent reconnect loop...`);
        await clearWhatsAppSession(profileId, supabase);
        sessionStates.set(profileId, {
          status: 'unlinked',
          updatedAt: new Date().toISOString(),
        });
        activeClients.delete(profileId);

        // Auto-restart with fresh QR if in terminal/linking mode
        if (options.printQRTerminal !== false && !options._restarted) {
          console.log(`[whatsapp/client] Generating fresh QR code...`);
          setTimeout(() => {
            initWhatsApp(profileId, { ...options, forceRelink: true, _restarted: true }).catch((err) =>
              console.error('[whatsapp/client] Fresh QR error:', err.message)
            );
          }, 1000);
        }
      } else {
        sessionStates.set(profileId, {
          status: 'connecting',
          updatedAt: new Date().toISOString(),
        });
        // Auto-reconnect after temporary network drop
        setTimeout(() => {
          if (activeClients.get(profileId) === sock) {
            initWhatsApp(profileId, { ...options, forceNew: true }).catch((err) =>
              console.error('[whatsapp/client] Reconnect error:', err.message)
            );
          }
        }, 3000);
      }
    }
  });

  // 3. Inbound message handling with verified registration and detailed logging
  console.log(`[whatsapp/client] 📡 Registering sock.ev.on('messages.upsert') event listener for profile ${profileId}...`);

  sock.ev.on('messages.upsert', async (m) => {
    const { messages, type } = m;
    if (!messages || messages.length === 0) return;

    for (const msg of messages) {
      const senderJid = msg.key?.remoteJid || '';
      const fromMe = Boolean(msg.key?.fromMe);
      const pushName = msg.pushName || (fromMe ? 'You (Linked Device)' : 'Sender');
      const timestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
      const timestampIso = new Date(timestamp).toISOString();
      const messageType = getMessageType(msg);
      const text = extractMessageText(msg);

      // Filter: Ignore WhatsApp status broadcast updates
      if (senderJid === 'status@broadcast') {
        continue;
      }

      // Filter: Ignore protocol-only / receipt messages with no user content
      if (messageType === 'protocolMessage' || messageType === 'reactionMessage' || (!text && !msg.message)) {
        continue;
      }

      // Log EVERY received user message with full details
      console.log(`\n💬 ─────────────────────────────────────────────────────────────`);
      console.log(`   [WHATSAPP MESSAGE RECEIVED]`);
      console.log(`   • Sender:    ${senderJid} (${pushName})`);
      console.log(`   • From Me:   ${fromMe ? 'Yes (sent from linked account)' : 'No (incoming reply)'}`);
      console.log(`   • Type:      ${messageType}`);
      console.log(`   • Text:      "${text || '[non-text content]'}"`);
      console.log(`   • Timestamp: ${timestampIso}`);
      console.log(`   • Event:     ${type}`);
      console.log(`────────────────────────────────────────────────────────────────\n`);

      if (!text) continue;

      // Dispatch to specific onMessage callback if provided
      if (options.onMessage) {
        try {
          await options.onMessage(msg, text.trim(), senderJid);
        } catch (msgErr) {
          console.warn('[whatsapp/client] onMessage callback error:', msgErr.message);
        }
      } else {
        // Default: dispatch to job confirmation state machine
        try {
          const { handleWhatsAppInboundReply } = await import('./jobConfirmation.js');
          await handleWhatsAppInboundReply(profileId, senderJid, text.trim(), { supabase });
        } catch (jobReplyErr) {
          console.warn('[whatsapp/client] handleWhatsAppInboundReply error:', jobReplyErr.message);
        }
      }

      // Dispatch to globally registered message listeners for this profile
      const listeners = messageListeners.get(profileId);
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) {
          try {
            await listener(msg, text.trim(), senderJid);
          } catch (listErr) {
            console.warn('[whatsapp/client] registered listener error:', listErr.message);
          }
        }
      }
    }
  });

  return {
    sock,
    ...getWhatsAppSessionState(profileId),
  };
}

/**
 * Retrieves the active Baileys socket for a profile.
 *
 * @param {string} profileId
 * @returns {import('@whiskeysockets/baileys').WASocket|null}
 */
export function getWhatsAppClient(profileId) {
  return activeClients.get(profileId) || null;
}

/**
 * Sends a text message to a WhatsApp recipient.
 *
 * @param {string|import('@whiskeysockets/baileys').WASocket} profileIdOrSock - Profile ID or active WASocket
 * @param {string} toPhoneOrJid - Recipient phone number or WhatsApp JID
 * @param {string} text - Message text
 * @param {object} [options={}]
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function sendWhatsAppMessage(profileIdOrSock, toPhoneOrJid, text, options = {}) {
  let sock = null;

  if (typeof profileIdOrSock === 'string') {
    sock = getWhatsAppClient(profileIdOrSock);
    if (!sock) {
      const initResult = await initWhatsApp(profileIdOrSock, options);
      sock = initResult.sock;
    }
  } else if (profileIdOrSock && typeof profileIdOrSock === 'object') {
    sock = profileIdOrSock;
  }

  if (!sock) {
    console.error('[whatsapp/client] No active WhatsApp socket available to send message');
    return { ok: false, error: 'no_active_socket' };
  }

  const jid = formatJid(toPhoneOrJid);
  if (!jid) {
    console.error('[whatsapp/client] Invalid recipient for sendWhatsAppMessage:', toPhoneOrJid);
    return { ok: false, error: 'invalid_recipient' };
  }

  try {
    console.log(`[whatsapp/client] 📤 Sending WhatsApp message to ${jid}: "${text.slice(0, 60).replace(/\n/g, ' ')}..."`);
    const result = await sock.sendMessage(jid, { text });
    return {
      ok: true,
      messageId: result?.key?.id,
      result,
    };
  } catch (err) {
    console.error('[whatsapp/client] sendWhatsAppMessage error:', err.message || err);
    return {
      ok: false,
      error: err.message || 'send_failed',
    };
  }
}

/**
 * Disconnects and cleans up a WhatsApp socket for a profile.
 *
 * @param {string} profileId
 */
export async function disconnectWhatsApp(profileId) {
  const sock = activeClients.get(profileId);
  if (sock) {
    try {
      sock.end(undefined);
    } catch {
      // Ignored
    }
    activeClients.delete(profileId);
  }
  sessionStates.delete(profileId);
  messageListeners.delete(profileId);
  console.log(`[whatsapp/client] Disconnected and cleaned up WhatsApp client for profile ${profileId}`);
}
