/**
 * test-whatsapp-live.js
 *
 * Interactive Live WhatsApp Test:
 * 1. Initializes Baileys and prints QR code in terminal for you to scan with your phone.
 * 2. On scan, links your WhatsApp session to your profile in Supabase.
 * 3. Seeds a test job in handshake_jobs.
 * 4. Sends a real WhatsApp message to your phone with job details.
 * 5. Listens for you to reply "YES" on your phone.
 * 6. Updates database to QUEUED and sends confirmation message back.
 *
 * Usage:
 *   node test-whatsapp-live.js
 *   node test-whatsapp-live.js --force-relink    (forces clean fresh QR in terminal)
 *   npm run test:whatsapp:live
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  initWhatsApp,
  getWhatsAppSessionState,
} from './lib/whatsapp/client.js';
import {
  sendWhatsAppJobConfirmation,
  pollForWhatsAppReply,
} from './lib/whatsapp/jobConfirmation.js';

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
  console.log('  📱 Live Interactive WhatsApp Baileys Test                      ');
  console.log('================================================================\n');

  // Parse CLI flags
  const args = process.argv.slice(2);
  const forceRelink = args.includes('--force-relink') || args.includes('--relink') || args.includes('--fresh');

  if (forceRelink) {
    console.log('🔄 [--force-relink flag active]: Clearing previous session and forcing fresh QR in terminal.\n');
  }

  // 1. Get or resolve user profile
  let { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!profile) {
    console.error('❌ No user profile found in Supabase database.');
    process.exit(1);
  }

  console.log(`👤 Target Profile: ${profile.first_name || 'Student'} ${profile.last_name || ''} (${profile.id})`);

  // 2. Initialize Baileys with terminal QR
  console.log('\n🔄 Initializing Baileys client...');
  console.log('👉 If not already linked or on --force-relink, a QR code will appear below.');
  console.log('   Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device.\n');

  let connectedPhone = null;

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
        console.log(`\n🎉 Existing session active! Connected phone: +${currentState.phone}`);
        connectedPhone = currentState.phone;
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });

  // 3. 5-second delay to let Baileys session and socket sync fully settle
  console.log('\n⏳ Waiting 5 seconds for WhatsApp socket & session synchronization to fully settle...');
  await new Promise((r) => setTimeout(r, 5000));
  console.log('✅ Session synchronization settled.');

  // 4. Seed a test job in Supabase
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  Seeding Test Handshake Job                                    ');
  console.log('────────────────────────────────────────────────────────────────');

  const timestamp = Date.now();
  const jobTitle = `Senior Frontend Engineer (Live Test #${timestamp % 10000})`;
  const jobCompany = 'Handshake Partner Labs';
  const jobUrl = `https://app.joinhandshake.com/jobs/${timestamp % 1000000}`;

  const { data: seededJob, error: seedErr } = await supabase
    .from('handshake_jobs')
    .insert({
      profile_id: profile.id,
      title: jobTitle,
      company: jobCompany,
      location: 'San Francisco, CA (Remote)',
      url: jobUrl,
      has_quick_apply: true,
      discovered_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (seedErr || !seededJob) {
    console.error('❌ Failed to seed test job:', seedErr?.message);
    process.exit(1);
  }

  console.log(`🌱 Seeded Job:   "${seededJob.title}" at ${seededJob.company}`);
  console.log(`   Job ID:       ${seededJob.id}`);
  console.log(`   Job URL:      ${seededJob.url}`);

  // 5. Send real live WhatsApp message
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('  Sending Real WhatsApp Job Confirmation to Your Phone          ');
  console.log('────────────────────────────────────────────────────────────────');

  const targetJid = connectedPhone || profile.whatsapp_phone || profile.phone;
  console.log(`📱 Recipient Phone: +${targetJid.replace(/[^0-9]/g, '')}`);

  const sendResult = await sendWhatsAppJobConfirmation(profile.id, seededJob, {
    supabase,
    phone: targetJid,
  });

  if (!sendResult.ok) {
    console.error('❌ Failed to send WhatsApp job prompt:', sendResult.error);
    process.exit(1);
  }

  console.log('✅ Job confirmation prompt delivered to your WhatsApp!');
  console.log('\n📱 ACTION REQUIRED:');
  console.log('   Check your WhatsApp chat and reply "YES" (or "NO") to this message.');
  console.log('   Waiting for your reply (timeout: 90s)...');

  // 5. Poll for reply resolution in Supabase applications table
  const appResult = await pollForWhatsAppReply(profile.id, seededJob.id, {
    supabase,
    timeoutMs: 90000,
    intervalMs: 1500,
  });

  if (!appResult) {
    console.log('\n⏱ 90s elapsed without receiving a YES/NO reply in WhatsApp.');
    console.log('   The socket is still listening if you reply later.');
  } else {
    console.log('\n================================================================');
    console.log(`  🎉 INBOUND REPLY DETECTED! Application status: ${appResult.status}`);
    console.log('================================================================');
    console.log(`  Application ID: ${appResult.id}`);
    console.log(`  Profile ID:     ${appResult.profile_id}`);
    console.log(`  Job ID:         ${appResult.job_id}`);
    console.log(`  Status:         ${appResult.status}`);
    console.log(`  Queued At:      ${appResult.queued_at || appResult.finished_at}`);
    console.log('================================================================\n');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Live WhatsApp Test Exception:', err);
  process.exit(1);
});
