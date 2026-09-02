/**
 * test-telegram.js
 *
 * Standalone test script to verify sendTelegramMessage utility.
 *
 * Usage:
 *   node test-telegram.js [chatId] [botToken]
 *
 * Or via environment variables:
 *   CHAT_ID=<your_chat_id> TELEGRAM_BOT_TOKEN=<your_bot_token> node test-telegram.js
 */

import 'dotenv/config';
import { sendTelegramMessage } from './api/telegram/webhook.js';

async function main() {
  const args = process.argv.slice(2);

  // Read CLI arguments if provided
  let cliChatId = null;
  let cliToken = null;

  for (const arg of args) {
    if (arg.startsWith('--chat-id=') || arg.startsWith('--chatId=')) {
      cliChatId = arg.split('=')[1];
    } else if (arg.startsWith('--token=')) {
      cliToken = arg.split('=')[1];
    } else if (!cliChatId) {
      cliChatId = arg;
    } else if (!cliToken) {
      cliToken = arg;
    }
  }

  const chatId =
    cliChatId ||
    process.env.CHAT_ID ||
    process.env.TELEGRAM_CHAT_ID;

  if (cliToken) {
    process.env.TELEGRAM_BOT_TOKEN = cliToken;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  console.log('--- Telegram Send Utility Test (Phase A3) ---');

  if (!botToken) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is missing.');
    console.error('\nProvide it via env var or CLI argument:');
    console.error('  node test-telegram.js <chatId> <botToken>');
    console.error('  TELEGRAM_BOT_TOKEN=... CHAT_ID=... node test-telegram.js\n');
    process.exit(1);
  }

  if (!chatId) {
    console.error('❌ Error: CHAT_ID is missing.');
    console.error('\nProvide it via env var or CLI argument:');
    console.error('  node test-telegram.js <chatId> [botToken]');
    console.error('  CHAT_ID=... node test-telegram.js\n');
    process.exit(1);
  }

  console.log(`Target Chat ID: ${chatId}`);
  console.log(`Bot Token:      ${botToken.slice(0, 6)}...${botToken.slice(-4)}`);
  console.log('Sending test message: "Phase A3 test message"...\n');

  try {
    const result = await sendTelegramMessage(chatId, 'Phase A3 test message');

    if (result && result.ok) {
      console.log('✅ Success! Message sent successfully.');
      console.log('Message details:', JSON.stringify(result.result, null, 2));
      process.exit(0);
    } else {
      console.error('❌ Failed to send message.');
      if (result) {
        console.error('Telegram API error response:', JSON.stringify(result, null, 2));
      }
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Unexpected error occurred:', err.message);
    process.exit(1);
  }
}

main();
