/**
 * test-check-webhook.js
 *
 * Checks or updates the Telegram Bot Webhook registration status via Telegram Bot API:
 * - getWebhookInfo: returns the current registered URL, pending update count, and error history.
 * - setWebhook: registers a new webhook URL with allowed_updates: ['message', 'callback_query'].
 * - deleteWebhook: clears any registered webhook so bot can use getUpdates or be reset.
 *
 * Usage:
 *   node test-check-webhook.js
 *   node test-check-webhook.js --set=https://<YOUR_DEPLOYMENT_URL>/api/telegram/webhook
 *   node test-check-webhook.js --delete
 */

import 'dotenv/config';

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

  if (!token) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is not configured in environment.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let setUrl = null;
  let doDelete = false;

  for (const arg of args) {
    if (arg.startsWith('--set=') || arg.startsWith('--set-url=')) {
      setUrl = arg.split('=')[1];
    } else if (arg === '--delete' || arg === '--clear') {
      doDelete = true;
    }
  }

  console.log('================================================================');
  console.log('  Telegram Webhook Registration Inspector                       ');
  console.log('================================================================\n');

  console.log(`Bot Token: ${token.slice(0, 6)}...${token.slice(-4)}\n`);

  // Handle deleteWebhook
  if (doDelete) {
    console.log('🗑️ Deleting registered webhook...');
    const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    const delData = await delRes.json();
    if (delData.ok) {
      console.log('✅ Webhook deleted successfully.');
    } else {
      console.error('❌ deleteWebhook failed:', delData.description);
    }
    console.log('');
  }

  // Handle setWebhook
  if (setUrl) {
    console.log(`⚙️ Registering webhook URL: "${setUrl}"...`);
    const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: setUrl,
        allowed_updates: ['message', 'callback_query'],
      }),
    });
    const setData = await setRes.json();
    if (setData.ok) {
      console.log('✅ setWebhook successful! Allowed updates: ["message", "callback_query"]\n');
    } else {
      console.error('❌ setWebhook failed:', setData.description, '\n');
    }
  }

  // Check getWebhookInfo
  console.log('🔍 Fetching getWebhookInfo from Telegram API...');
  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const data = await res.json();

  if (!data.ok) {
    console.error('❌ getWebhookInfo API Error:', data.description);
    process.exit(1);
  }

  const info = data.result;

  console.log('\n----------------------------------------------------------------');
  console.log('  Current Telegram Webhook Info:                                ');
  console.log('----------------------------------------------------------------');
  console.log(`  Webhook URL:           ${info.url ? info.url : '⚠️ [NONE REGISTERED - Bot is not receiving webhooks]'}`);
  console.log(`  Has Custom Cert:       ${info.has_custom_certificate}`);
  console.log(`  Pending Updates:       ${info.pending_update_count}`);
  console.log(`  Max Connections:       ${info.max_connections || 40}`);
  console.log(`  Allowed Updates:       ${info.allowed_updates ? JSON.stringify(info.allowed_updates) : 'All updates (default)'}`);

  if (info.last_error_date) {
    const errorDate = new Date(info.last_error_date * 1000).toISOString();
    console.log(`\n  ⚠️ Last Delivery Error:`);
    console.log(`     Date:    ${errorDate}`);
    console.log(`     Message: ${info.last_error_message}`);
  }

  if (info.last_synchronization_error_date) {
    const syncErrorDate = new Date(info.last_synchronization_error_date * 1000).toISOString();
    console.log(`\n  ⚠️ Last Sync Error:`);
    console.log(`     Date: ${syncErrorDate}`);
  }

  console.log('----------------------------------------------------------------\n');

  if (!info.url) {
    console.log('💡 Tip: To register your serverless or ngrok tunnel URL with Telegram, run:');
    console.log('   node test-check-webhook.js --set=https://<YOUR_DEPLOYMENT_URL>/api/telegram/webhook\n');
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});
