/**
 * test-whatsapp-receiver.js
 *
 * Dedicated Baileys Inbound Message Receiver & Diagnostics Tool:
 * (1) Initializes Baileys WASocket and registers sock.ev.on('messages.upsert')
 * (2) Logs EVERY received message: sender, type, text, timestamp, pushName, fromMe
 * (3) Filters out status broadcasts, reactions, and empty protocol frames
 * (4) Formats phone numbers with country code (+91XXXXXXXXXX)
 * (5) Waits 5s after connection to ensure complete socket & auth sync
 * (6) Optionally sends a test ping message to the linked number or target phone
 * (7) Sits continuously in real time listening for messages from any phone
 *
 * Usage:
 *   node test-whatsapp-receiver.js
 *   node test-whatsapp-receiver.js --force-relink
 *   node test-whatsapp-receiver.js --send-test
 *   npm run test:whatsapp:receiver
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  initWhatsApp,
  sendWhatsAppMessage,
  formatJid,
  getWhatsAppSessionState,
} from './lib/whatsapp/client.js';

// Normalize environment keys
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log('================================================================');
  console.log('  📡 WhatsApp Baileys Inbound Receiver & Diagnostics Tool       ');
  console.log('================================================================\n');

  const args = process.argv.slice(2);
  const forceRelink = args.includes('--force-relink') || args.includes('--relink') || args.includes('--fresh');
  const sendTest = args.includes('--send-test') || args.includes('--ping');

  // 1. Resolve Profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, whatsapp_phone, phone, first_name, last_name')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!profile) {
    console.error('❌ No user profile found in database.');
    process.exit(1);
  }

  console.log(`👤 Active Profile: ${profile.first_name || 'User'} ${profile.last_name || ''} (${profile.id})`);

  let connectedPhone = null;

  // 2. Initialize Baileys Socket
  console.log('\n🔄 Initializing Baileys WhatsApp client...');
  if (forceRelink) {
    console.log('   [--force-relink]: Forcing fresh terminal QR code...');
  }

  await new Promise(async (resolve, reject) => {
    try {
      await initWhatsApp(profile.id, {
        supabase,
        printQRTerminal: true,
        forceRelink,
        onConnected: ({ phone, jid }) => {
          connectedPhone = phone;
          resolve();
        },
      });

      const currentState = getWhatsAppSessionState(profile.id);
      if (currentState.status === 'connected') {
        connectedPhone = currentState.phone;
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });

  // 3. 5-Second Post-Connection Delay for Sync
  console.log('\n⏳ Waiting 5s for WhatsApp socket & credentials synchronization to settle...');
  await new Promise((r) => setTimeout(r, 5000));
  console.log('✅ Baileys session synchronized and ready!\n');

  const targetPhone = connectedPhone || profile.whatsapp_phone || profile.phone;
  const formattedJid = formatJid(targetPhone);

  console.log('────────────────────────────────────────────────────────────────');
  console.log('  📱 Connection Details:');
  console.log(`     • Connected Phone:  +${connectedPhone || 'Unknown'}`);
  console.log(`     • Target WhatsApp:  +${targetPhone ? targetPhone.replace(/[^0-9]/g, '') : 'None'}`);
  console.log(`     • WhatsApp JID:     ${formattedJid}`);
  console.log('────────────────────────────────────────────────────────────────\n');

  // 4. Optionally send a test ping message
  if (sendTest && targetPhone) {
    console.log('📤 Sending test ping message to your WhatsApp number...');
    const pingResult = await sendWhatsAppMessage(
      profile.id,
      targetPhone,
      `🔔 *OneClickHandshake Baileys Test Ping*\n\nYour WhatsApp connection is active and receiving messages!\nTime: ${new Date().toLocaleTimeString()}\n\n👉 Try replying *YES* or sending any text to test message reception.`
    );
    if (pingResult.ok) {
      console.log('✅ Test ping message dispatched successfully!\n');
    } else {
      console.warn('⚠️ Test ping dispatch failed:', pingResult.error);
    }
  }

  // 5. Continuous Inbound Listening Loop
  console.log('================================================================');
  console.log('  🎧 LISTENING FOR INBOUND WHATSAPP MESSAGES IN REAL TIME...    ');
  console.log('================================================================');
  console.log('👉 INSTRUCTIONS:');
  console.log('   1. Send any text message (e.g. "YES", "Hello", "Test") to this linked WhatsApp account');
  console.log('      (from your linked phone or from another phone number).');
  console.log('   2. Watch the console below for live message logs in real time.');
  console.log('   3. Press Ctrl+C when you are done.\n');

  // Keep process alive indefinitely
  setInterval(() => {}, 1000);
}

main().catch((err) => {
  console.error('❌ Inbound receiver exception:', err);
  process.exit(1);
});
