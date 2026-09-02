/**
 * test-telegram-buttons.js
 *
 * Live Telegram Inline Button Confirmation Test Script
 *
 * Steps:
 * 1. Loads environment variables (SUPABASE_URL, SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WORKER_PROFILE_ID).
 * 2. Seeds one unique handshake_job row.
 * 3. Calls sendJobConfirmation(profileId, job) to send prompt with Yes/No inline buttons.
 * 4. Logs prompt instructions.
 * 5. Polls Supabase applications table every 2s for 30s.
 * 6. Logs status on QUEUED / REJECTED application creation or timeout.
 * 7. Outputs final application row details.
 *
 * Usage:
 *   npm run test-telegram-buttons
 */

import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { sendJobConfirmation } from './lib/telegram/jobConfirmation.js';

async function main() {
  console.log('================================================================');
  console.log('  Live Telegram Job Confirmation Button Test                    ');
  console.log('================================================================\n');

  // (1) Load env variables
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  const botToken =
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN;

  // Parse optional CLI arguments
  const args = process.argv.slice(2);
  let cliProfileId = null;
  let cliChatId = null;
  let cliWebhookUrl = null;

  for (const arg of args) {
    if (arg.startsWith('--profile=') || arg.startsWith('--profileId=') || arg.startsWith('--profile-id=')) {
      cliProfileId = arg.split('=')[1];
    } else if (arg.startsWith('--chat-id=') || arg.startsWith('--chatId=') || arg.startsWith('--chat=')) {
      cliChatId = arg.split('=')[1];
    } else if (arg.startsWith('--set-webhook=') || arg.startsWith('--webhook=') || arg.startsWith('--set-url=')) {
      cliWebhookUrl = arg.split('=')[1];
    } else if (!cliProfileId && !arg.startsWith('--')) {
      cliProfileId = arg;
    } else if (!cliChatId && !arg.startsWith('--')) {
      cliChatId = arg;
    }
  }

  let profileId =
    cliProfileId ||
    process.env.WORKER_PROFILE_ID ||
    process.env.PROFILE_ID;

  let telegramChatId =
    cliChatId ||
    process.env.TELEGRAM_CHAT_ID ||
    process.env.CHAT_ID;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }

  if (!botToken) {
    console.error('❌ Error: Missing TELEGRAM_BOT_TOKEN in env.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Resolve profile and telegram_chat_id
  if (!profileId) {
    if (telegramChatId) {
      const { data: matchedProfile } = await supabase
        .from('profiles')
        .select('id, telegram_chat_id, first_name, last_name')
        .eq('telegram_chat_id', String(telegramChatId))
        .maybeSingle();

      if (matchedProfile) {
        profileId = matchedProfile.id;
        console.log(`ℹ️ Auto-resolved WORKER_PROFILE_ID=${profileId} from TELEGRAM_CHAT_ID=${telegramChatId}`);
      }
    }

    if (!profileId) {
      const { data: firstProfile } = await supabase
        .from('profiles')
        .select('id, telegram_chat_id, first_name, last_name')
        .not('telegram_chat_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (firstProfile) {
        profileId = firstProfile.id;
        telegramChatId = telegramChatId || firstProfile.telegram_chat_id;
        console.log(`ℹ️ Auto-resolved WORKER_PROFILE_ID=${profileId} (${firstProfile.first_name || ''} ${firstProfile.last_name || ''})`);
      } else {
        console.error('❌ Error: WORKER_PROFILE_ID or PROFILE_ID is not set, and no profile with linked telegram_chat_id was found.');
        process.exit(1);
      }
    }
  }

  // Ensure profile has telegram_chat_id linked
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, telegram_chat_id, first_name, last_name')
    .eq('id', profileId)
    .maybeSingle();

  if (profileErr || !profile) {
    console.error(`❌ Error: Profile "${profileId}" not found in database.`);
    process.exit(1);
  }

  if (!profile.telegram_chat_id && telegramChatId) {
    await supabase
      .from('profiles')
      .update({ telegram_chat_id: String(telegramChatId) })
      .eq('id', profileId);
    profile.telegram_chat_id = String(telegramChatId);
    console.log(`ℹ️ Linked telegram_chat_id=${telegramChatId} to profile ${profileId}`);
  } else if (!profile.telegram_chat_id) {
    console.error(`❌ Error: Profile "${profileId}" has no telegram_chat_id linked and TELEGRAM_CHAT_ID env is not set.`);
    process.exit(1);
  }

  console.log(`👤 Target Profile: ${profile.first_name || ''} ${profile.last_name || ''} (${profileId})`);
  console.log(`💬 Telegram Chat ID: ${profile.telegram_chat_id}\n`);

  // (0) Verify Telegram Webhook Registration Status via getWebhookInfo
  console.log('🔍 Checking Telegram getWebhookInfo status...');
  try {
    const webhookInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const webhookInfo = await webhookInfoRes.json();

    if (webhookInfo && webhookInfo.ok) {
      const currentUrl = webhookInfo.result.url || '';
      console.log('🌐 Telegram Webhook Registration Info:');
      console.log(`   Registered Webhook URL: ${currentUrl ? currentUrl : '⚠️ [NONE REGISTERED - Bot is not receiving webhooks]'}`);
      console.log(`   Pending Update Count:   ${webhookInfo.result.pending_update_count}`);
      if (webhookInfo.result.last_error_message) {
        console.log(`   ⚠️ Last Error:           ${webhookInfo.result.last_error_message} (${new Date(webhookInfo.result.last_error_date * 1000).toISOString()})`);
      }
      if (webhookInfo.result.allowed_updates) {
        console.log(`   Allowed Updates:        ${JSON.stringify(webhookInfo.result.allowed_updates)}`);
      }

      // If user passed a webhook URL to set
      const requestedWebhookUrl = cliWebhookUrl || process.env.WEBHOOK_URL || process.env.TELEGRAM_WEBHOOK_URL;
      if (requestedWebhookUrl && requestedWebhookUrl !== currentUrl) {
        console.log(`\n⚙️ Setting Telegram Webhook URL to: "${requestedWebhookUrl}"...`);
        const setRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: requestedWebhookUrl,
            allowed_updates: ['message', 'callback_query'],
          }),
        });
        const setResult = await setRes.json();
        if (setResult.ok) {
          console.log(`✅ setWebhook successful: ${requestedWebhookUrl}`);
        } else {
          console.error(`❌ setWebhook failed: ${setResult.description}`);
        }
      } else if (!currentUrl) {
        console.log('\n⚠️ WARNING: No webhook URL registered with Telegram!');
        console.log('   Telegram button clicks cannot reach /api/telegram/webhook until you set a URL.');
        console.log('   To set a webhook URL (e.g. ngrok tunnel or Vercel deployment), pass:');
        console.log('   node test-telegram-buttons.js --set-url=https://<YOUR_DEPLOYMENT_URL>/api/telegram/webhook\n');
      }
      console.log('');
    } else {
      console.warn('⚠️ Could not fetch getWebhookInfo from Telegram API:', webhookInfo?.description);
    }
  } catch (webhookErr) {
    console.warn('⚠️ Exception checking Telegram getWebhookInfo:', webhookErr.message);
  }

  // (1) Clean slate: delete ALL existing handshake_jobs + applications for this profileId
  console.log('🧹 [Clean Slate] Cleaning up previous jobs and applications for profile:', profileId);
  const { data: existingApps } = await supabase
    .from('applications')
    .select('id')
    .eq('profile_id', profileId);

  if (existingApps && existingApps.length > 0) {
    const appIds = existingApps.map((a) => a.id);
    await supabase.from('application_events').delete().in('application_id', appIds);
  }

  await supabase.from('applications').delete().eq('profile_id', profileId);
  await supabase.from('handshake_jobs').delete().eq('profile_id', profileId);
  console.log('✨ Clean slate ready.\n');

  // (2) Seed ONE handshake_job row
  const timestamp = Date.now();
  const jobTitle = `Software Engineer (Button Test #${timestamp % 10000})`;
  const jobCompany = 'Handshake Automation Labs';
  const jobLocation = 'San Francisco, CA (Remote)';
  const jobUrl = `https://app.joinhandshake.com/jobs/test-${timestamp}`;

  const { data: seededJob, error: seedError } = await supabase
    .from('handshake_jobs')
    .insert({
      profile_id: profileId,
      title: jobTitle,
      company: jobCompany,
      location: jobLocation,
      url: jobUrl,
      has_quick_apply: true,
      discovered_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (seedError || !seededJob) {
    console.error('❌ Error seeding handshake_job row:', seedError?.message);
    process.exit(1);
  }

  console.log(`🌱 Seeded handshake_job: "${jobTitle}" at ${jobCompany}`);
  console.log(`   Job ID:     ${seededJob.id}`);
  console.log(`   Profile ID: ${profileId}`);
  console.log(`   URL:        ${jobUrl}\n`);

  // (3) Send job confirmation, log callback_data being sent
  const expectedYesCallback = `job:yes:${seededJob.id}`;
  const expectedNoCallback = `job:no:${seededJob.id}`;

  console.log('📤 Sending Telegram job confirmation prompt with Yes/No inline buttons...');
  console.log(`   Yes Button callback_data: "${expectedYesCallback}"`);
  console.log(`   No Button callback_data:  "${expectedNoCallback}"`);

  const sendResult = await sendJobConfirmation(profileId, seededJob, {
    supabase,
    chatId: profile.telegram_chat_id,
  });

  if (!sendResult.ok) {
    console.error('❌ Failed to send Telegram prompt:', sendResult.error);
    process.exit(1);
  }

  // (4) Log prompt notification
  console.log('📱 Message sent. Check Telegram now. Click Yes or No button on the message.\n');
  console.log(`🔍 Polling applications table WHERE:`);
  console.log(`   profile_id = "${profileId}"`);
  console.log(`   job_id     = "${seededJob.id}" (EXACT SEEDED JOB ID)\n`);

  // Allow a 2s initial grace period for Telegram delivery & webhook processing
  console.log('⏳ Waiting 2s before polling applications table...');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // (5) Poll Supabase applications table every 2s for 30s
  const POLL_INTERVAL_MS = 2000;
  const TIMEOUT_MS = 30000;
  const startTime = Date.now();

  let finalApp = null;
  let pollCount = 0;

  process.stdout.write('⏳ Waiting for button click in Telegram');

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    pollCount++;
    process.stdout.write('.');

    const { data: app, error: appError } = await supabase
      .from('applications')
      .select('*')
      .eq('profile_id', profileId)
      .eq('job_id', seededJob.id)
      .maybeSingle();

    if (appError) {
      console.error('\n⚠️ Poll query error:', appError.message);
      continue;
    }

    if (app) {
      finalApp = app;
      console.log('\n');
      // (6) & (7) Handle status
      if (app.status === 'QUEUED') {
        console.log(`✅ Yes clicked → QUEUED application created for jobId: ${seededJob.id}`);
      } else if (app.status === 'REJECTED') {
        console.log(`❌ No clicked → REJECTED application created for jobId: ${seededJob.id}`);
      } else {
        console.log(`ℹ️ Button resolved → Application status: ${app.status} for jobId: ${seededJob.id}`);
      }
      break;
    }
  }

  // (8) Timeout check
  if (!finalApp) {
    console.log('\n');
    console.log('⏱ No response detected after 30s');
  }

  // Output logs/webhook.log
  const logFilePath = path.resolve(process.cwd(), 'logs', 'webhook.log');
  console.log('\n----------------------------------------------------------------');
  console.log('  logs/webhook.log Content:                                     ');
  console.log('----------------------------------------------------------------');
  if (fs.existsSync(logFilePath)) {
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    console.log(logContent.trim() || '(empty log file)');
  } else {
    console.log('(logs/webhook.log file does not exist)');
  }
  console.log('----------------------------------------------------------------');

  console.log('\nDone.');
  process.exit(finalApp ? 0 : 0);
}

main().catch((err) => {
  console.error('\n❌ Unexpected error in test-telegram-buttons:', err);
  process.exit(1);
});
