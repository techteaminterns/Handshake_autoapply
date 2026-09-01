/**
 * test-a4-harness.js
 *
 * Phase V1-A4 Checkpoint Test Harness: Telegram Inline Yes/No Job Confirmation
 *
 * Validates the complete Telegram confirmation flow against the test matrix:
 * 1. Format verification: prompt text contains job title, company, url, and button tap prompt.
 *    - Validates InlineKeyboardMarkup structure and payload sizing under 64-byte limit.
 * 2. Send utility & queue advance:
 *    - Prompts oldest unconfirmed job with inline Yes/No buttons.
 *    - Enforces 1 pending prompt at a time (does not send second prompt while first is pending).
 * 3. Webhook callback query handling & state machine:
 *    - Button click "Yes" (job:yes:<uuid>) -> answers query, strips buttons, creates QUEUED application row, stamps resolved_at, auto-advances to next job.
 *    - Button click "No" (job:no:<uuid>) -> answers query, strips buttons, creates REJECTED application row, stamps resolved_at.
 *    - User types text while pending -> sends hint to tap Yes/No on message, leaves prompt open without RPC call.
 *    - Duplicate callback query -> answered, stripped, and ignored (prompt already resolved).
 *    - Callback / reply with no pending job -> ignored silently.
 *    - Permanent rejection -> cannot be queued later.
 * 4. Multi-job sequence:
 *    - Inserts 3 jobs, verifies they are prompted sequentially one by one upon button click.
 *
 * Usage:
 *   node test-a4-harness.js
 */

import 'dotenv/config';
import { createSupabaseAdmin } from './lib/supabase/admin.js';
import {
  buildJobConfirmationKeyboard,
  formatJobConfirmationMessage,
  getPendingConfirmationJob,
  getNextJobAwaitingPrompt,
  sendJobConfirmation,
  advanceConfirmationQueue,
  resolvePendingConfirmation,
} from './lib/telegram/jobConfirmation.js';
import {
  onTelegramReply,
  onTelegramCallbackQuery,
} from './api/telegram/webhook.js';

const TEST_PROFILE_ID = '11111111-a4a4-1111-a4a4-111111111111';
const TEST_CHAT_ID = 999111222;

const JOB_1_ID = 'aaaaaaaa-1111-aaaa-1111-aaaaaaaaaaaa';
const JOB_2_ID = 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa';
const JOB_3_ID = 'aaaaaaaa-3333-aaaa-3333-aaaaaaaaaaaa';

async function setupTestData(supabase) {
  console.log('\n[Setup] Cleaning up previous test records...');
  await supabase.from('application_events').delete().eq('application_id', JOB_1_ID);
  await supabase.from('applications').delete().eq('profile_id', TEST_PROFILE_ID);
  await supabase.from('handshake_jobs').delete().eq('profile_id', TEST_PROFILE_ID);
  await supabase.from('profiles').delete().eq('id', TEST_PROFILE_ID);
  try {
    await supabase.auth.admin.deleteUser(TEST_PROFILE_ID);
  } catch (_) {}

  console.log('[Setup] Creating test user and profile with telegram_chat_id...');
  const { error: userError } = await supabase.auth.admin.createUser({
    id: TEST_PROFILE_ID,
    email: 'test.a4@example.com',
    password: 'password123',
    email_confirm: true,
  });
  if (userError && !userError.message.includes('already registered')) throw userError;

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: TEST_PROFILE_ID,
    first_name: 'Test',
    last_name: 'Candidate',
    student_email: 'test.a4@example.com',
    phone: '5550001111',
    school_name: 'A4 Tech',
    major: 'CS',
    degree_pursuing: 'BS',
    grad_month: 'May',
    grad_year: 2026,
    has_existing_handshake_account: true,
    telegram_chat_id: String(TEST_CHAT_ID),
  });
  if (profileError) throw profileError;
}

async function cleanupTestData(supabase) {
  console.log('\n[Cleanup] Cleaning up test records...');
  await supabase.from('applications').delete().eq('profile_id', TEST_PROFILE_ID);
  await supabase.from('handshake_jobs').delete().eq('profile_id', TEST_PROFILE_ID);
  await supabase.from('profiles').delete().eq('id', TEST_PROFILE_ID);
  try {
    await supabase.auth.admin.deleteUser(TEST_PROFILE_ID);
  } catch (_) {}
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('  Phase V1-A4: Telegram Inline Job Confirmation Test Suite      ');
  console.log('================================================================');

  const supabase = createSupabaseAdmin();
  await setupTestData(supabase);

  // Mock Telegram API calls
  const sentMessages = [];
  const answeredQueries = [];
  const editedMarkups = [];

  const mockTelegramSend = async (chatId, text, options) => {
    const msgId = sentMessages.length + 100;
    sentMessages.push({ chatId, text, options, messageId: msgId, timestamp: new Date() });
    return { ok: true, result: { message_id: msgId, text } };
  };

  const mockTelegramAnswer = async (queryId, options = {}) => {
    answeredQueries.push({ queryId, options, timestamp: new Date() });
    return { ok: true, result: true };
  };

  const mockTelegramEditMarkup = async (chatId, messageId, replyMarkup) => {
    editedMarkups.push({ chatId, messageId, replyMarkup, timestamp: new Date() });
    return { ok: true, result: true };
  };

  try {
    // -------------------------------------------------------------------------
    // Test 1: Message Formatting & Inline Keyboard Markup
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: formatJobConfirmationMessage & buildJobConfirmationKeyboard ---');
    const sampleJob = {
      id: JOB_1_ID,
      title: 'Full Stack Engineer',
      company: 'Acme Systems',
      url: 'https://app.joinhandshake.com/jobs/12345',
    };
    const formatted = formatJobConfirmationMessage(sampleJob);
    assert(formatted.includes('Apply to Full Stack Engineer at Acme Systems?'), 'Formatted text contains title and company');
    assert(formatted.includes('https://app.joinhandshake.com/jobs/12345'), 'Formatted text contains job URL');
    assert(formatted.includes('Tap Yes to queue or No to skip.'), 'Formatted text contains button prompt copy');

    const keyboard = buildJobConfirmationKeyboard(JOB_1_ID);
    assert(Array.isArray(keyboard?.inline_keyboard), 'buildJobConfirmationKeyboard returns inline_keyboard array');
    assert(keyboard.inline_keyboard[0].length === 2, 'inline_keyboard has 2 buttons in first row');
    assert(keyboard.inline_keyboard[0][0].text === 'Yes', 'First button is "Yes"');
    assert(keyboard.inline_keyboard[0][0].callback_data === `job:yes:${JOB_1_ID}`, 'First button callback_data is job:yes:<uuid>');
    assert(keyboard.inline_keyboard[0][1].text === 'No', 'Second button is "No"');
    assert(keyboard.inline_keyboard[0][1].callback_data === `job:no:${JOB_1_ID}`, 'Second button callback_data is job:no:<uuid>');
    assert(Buffer.byteLength(keyboard.inline_keyboard[0][0].callback_data, 'utf8') <= 64, 'callback_data stays under 64 bytes');

    // -------------------------------------------------------------------------
    // Test 2: Seed 3 Scraped Jobs
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Seed 3 Scraped Jobs (Queue Ordering) ---');
    const now = Date.now();
    await supabase.from('handshake_jobs').insert([
      {
        id: JOB_1_ID,
        profile_id: TEST_PROFILE_ID,
        title: 'Junior SWE',
        company: 'Alpha Inc',
        url: 'https://app.joinhandshake.com/jobs/101',
        has_quick_apply: true,
        discovered_at: new Date(now - 30000).toISOString(), // Oldest
      },
      {
        id: JOB_2_ID,
        profile_id: TEST_PROFILE_ID,
        title: 'Backend Dev',
        company: 'Beta LLC',
        url: 'https://app.joinhandshake.com/jobs/102',
        has_quick_apply: true,
        discovered_at: new Date(now - 20000).toISOString(),
      },
      {
        id: JOB_3_ID,
        profile_id: TEST_PROFILE_ID,
        title: 'ML Engineer',
        company: 'Gamma AI',
        url: 'https://app.joinhandshake.com/jobs/103',
        has_quick_apply: false,
        discovered_at: new Date(now - 10000).toISOString(), // Newest
      },
    ]);
    console.log('  ✓ Inserted 3 unprompted handshake_jobs (ordered by discovered_at)');

    // -------------------------------------------------------------------------
    // Test 3: Advance Queue -> Prompts Oldest Job (Job 1) with Inline Buttons
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: advanceConfirmationQueue prompts oldest job with inline keyboard ---');
    const advance1 = await advanceConfirmationQueue(TEST_PROFILE_ID, {
      supabase,
      telegramSendFn: mockTelegramSend,
    });
    assert(advance1.status === 'sent', 'advanceConfirmationQueue returned status "sent"');
    assert(advance1.job.id === JOB_1_ID, 'Prompted oldest job (Job 1)');
    assert(sentMessages.length === 1, 'Exactly one Telegram message sent');
    assert(sentMessages[0].text.includes('Junior SWE at Alpha Inc'), 'Message text matches Job 1');
    assert(
      sentMessages[0].options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `job:yes:${JOB_1_ID}`,
      'Message includes inline Yes button with callback_data job:yes:<jobId>'
    );
    assert(
      sentMessages[0].options?.reply_markup?.inline_keyboard?.[0]?.[1]?.callback_data === `job:no:${JOB_1_ID}`,
      'Message includes inline No button with callback_data job:no:<jobId>'
    );

    // Verify DB timestamp stamped
    const pendingJobAfterAdvance = await getPendingConfirmationJob(supabase, TEST_PROFILE_ID);
    assert(pendingJobAfterAdvance !== null, 'Pending unconfirmed job found');
    assert(pendingJobAfterAdvance.id === JOB_1_ID, 'Pending job matches Job 1');
    assert(pendingJobAfterAdvance.telegram_prompt_sent_at !== null, 'telegram_prompt_sent_at is stamped');
    assert(pendingJobAfterAdvance.telegram_prompt_resolved_at === null, 'telegram_prompt_resolved_at is null');

    // -------------------------------------------------------------------------
    // Test 4: Queue Serialization (One Pending at a Time)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: One Pending Job at a Time Rule ---');
    const advance2 = await advanceConfirmationQueue(TEST_PROFILE_ID, {
      supabase,
      telegramSendFn: mockTelegramSend,
    });
    assert(advance2.status === 'already_pending', 'advanceConfirmationQueue returned "already_pending"');
    assert(advance2.job.id === JOB_1_ID, 'Identified existing pending Job 1');
    assert(sentMessages.length === 1, 'No additional Telegram message sent while prompt is pending');

    // -------------------------------------------------------------------------
    // Test 5: User types text while pending -> Hint sent, prompt stays open
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Inbound text while confirmation pending hints button tap ---');
    await onTelegramReply(TEST_CHAT_ID, { text: 'maybe later' }, {}, { supabase, telegramSendFn: mockTelegramSend });
    assert(sentMessages.length === 2, 'Sent hint message when user typed text');
    assert(sentMessages[1].text.includes('Please tap Yes or No on the job message.'), 'Hint text matched');

    // Verify job is STILL pending (not resolved by typed text)
    const stillPending = await getPendingConfirmationJob(supabase, TEST_PROFILE_ID);
    assert(stillPending !== null && stillPending.id === JOB_1_ID, 'Job 1 is still pending');

    // -------------------------------------------------------------------------
    // Test 6: Inbound message from unknown / unlinked chat_id -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Unlinked chat_id ignored silently ---');
    const initialMsgCount = sentMessages.length;
    await onTelegramReply(999999999, { text: 'hello' }, {}, { supabase, telegramSendFn: mockTelegramSend });
    assert(sentMessages.length === initialMsgCount, 'No reply sent to unknown chat_id');

    // -------------------------------------------------------------------------
    // Test 7: User clicks "Yes" button for Job 1 -> QUEUED Application + Auto-advance to Job 2
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: User clicks "Yes" button via onTelegramCallbackQuery ---');
    const job1MsgId = sentMessages[0].messageId;
    await onTelegramCallbackQuery(
      {
        id: 'cb_query_1',
        data: `job:yes:${JOB_1_ID}`,
        message: {
          message_id: job1MsgId,
          chat: { id: TEST_CHAT_ID },
        },
      },
      {},
      {
        supabase,
        telegramSendFn: mockTelegramSend,
        telegramAnswerFn: mockTelegramAnswer,
        telegramEditMarkupFn: mockTelegramEditMarkup,
      }
    );

    // Verify callback query answered
    assert(answeredQueries.some((q) => q.queryId === 'cb_query_1'), 'answerCallbackQuery called for query cb_query_1');

    // Verify buttons stripped from original message
    assert(
      editedMarkups.some((e) => e.messageId === job1MsgId && JSON.stringify(e.replyMarkup) === JSON.stringify({ inline_keyboard: [] })),
      'editTelegramMessageReplyMarkup stripped inline keyboard from original prompt'
    );

    // Verify applications row created
    const { data: app1 } = await supabase
      .from('applications')
      .select('*')
      .eq('profile_id', TEST_PROFILE_ID)
      .eq('job_id', JOB_1_ID)
      .single();
    assert(app1 !== null, 'Application row created for Job 1');
    assert(app1.status === 'QUEUED', 'Application status is QUEUED');
    assert(app1.queued_at !== null, 'Application queued_at is populated');

    // Verify Job 1 prompt resolved
    const { data: job1Db } = await supabase.from('handshake_jobs').select('*').eq('id', JOB_1_ID).single();
    assert(job1Db.telegram_prompt_resolved_at !== null, 'Job 1 telegram_prompt_resolved_at is populated');

    // Verify Job 2 was automatically prompted via advanceConfirmationQueue with inline keyboard
    const job2PromptMsg = sentMessages.find((m) => m.text.includes('Backend Dev at Beta LLC'));
    assert(job2PromptMsg !== undefined, 'Job 2 auto-prompted after YES button click');
    assert(
      job2PromptMsg.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `job:yes:${JOB_2_ID}`,
      'Job 2 prompt includes inline Yes button with callback_data job:yes:<JOB_2_ID>'
    );

    // -------------------------------------------------------------------------
    // Test 8: Duplicate button click on resolved Job 1 -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Duplicate button click on resolved job ignored ---');
    await onTelegramCallbackQuery(
      {
        id: 'cb_query_1_dup',
        data: `job:yes:${JOB_1_ID}`,
        message: {
          message_id: job1MsgId,
          chat: { id: TEST_CHAT_ID },
        },
      },
      {},
      {
        supabase,
        telegramSendFn: mockTelegramSend,
        telegramAnswerFn: mockTelegramAnswer,
        telegramEditMarkupFn: mockTelegramEditMarkup,
      }
    );
    assert(answeredQueries.some((q) => q.queryId === 'cb_query_1_dup'), 'answerCallbackQuery called for duplicate query');

    // -------------------------------------------------------------------------
    // Test 9: Active unconfirmed job is now Job 2
    // -------------------------------------------------------------------------
    console.log('\n--- Test 9: Active unconfirmed job is now Job 2 ---');
    const pendingJob2 = await getPendingConfirmationJob(supabase, TEST_PROFILE_ID);
    assert(pendingJob2 !== null && pendingJob2.id === JOB_2_ID, 'Pending job is now Job 2');

    // -------------------------------------------------------------------------
    // Test 10: User clicks "No" button on Job 2 -> REJECTED Application + Auto-advance to Job 3
    // -------------------------------------------------------------------------
    console.log('\n--- Test 10: User clicks "No" button for Job 2 via onTelegramCallbackQuery ---');
    const job2MsgId = job2PromptMsg.messageId;
    await onTelegramCallbackQuery(
      {
        id: 'cb_query_2',
        data: `job:no:${JOB_2_ID}`,
        message: {
          message_id: job2MsgId,
          chat: { id: TEST_CHAT_ID },
        },
      },
      {},
      {
        supabase,
        telegramSendFn: mockTelegramSend,
        telegramAnswerFn: mockTelegramAnswer,
        telegramEditMarkupFn: mockTelegramEditMarkup,
      }
    );

    const { data: app2 } = await supabase
      .from('applications')
      .select('*')
      .eq('profile_id', TEST_PROFILE_ID)
      .eq('job_id', JOB_2_ID)
      .single();
    assert(app2 !== null, 'Application row created for Job 2');
    assert(app2.status === 'REJECTED', 'Application status is REJECTED');
    assert(app2.finished_at !== null, 'Application finished_at is populated');

    // Verify Job 3 was auto-prompted with inline keyboard
    const job3PromptMsg = sentMessages.find((m) => m.text.includes('ML Engineer at Gamma AI'));
    assert(job3PromptMsg !== undefined, 'Job 3 auto-prompted after NO button click');
    assert(
      job3PromptMsg.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `job:yes:${JOB_3_ID}`,
      'Job 3 prompt includes inline Yes button'
    );

    // -------------------------------------------------------------------------
    // Test 11: Late "YES" button click on permanently REJECTED Job 2 -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 11: Late YES button click on previously REJECTED job blocked ---');
    // Temporarily clear resolved_at on job 2 to test race condition
    await supabase.from('handshake_jobs').update({ telegram_prompt_resolved_at: null }).eq('id', JOB_2_ID);
    const rejectRetry = await resolvePendingConfirmation(TEST_PROFILE_ID, JOB_2_ID, 'yes', { supabase });
    assert(rejectRetry.status === 'ignored_permanent_reject', 'Permanent reject honored (returned "ignored_permanent_reject")');
    await supabase.from('handshake_jobs').update({ telegram_prompt_resolved_at: new Date().toISOString() }).eq('id', JOB_2_ID);

    // -------------------------------------------------------------------------
    // Test 12: Resolve Job 3 with "YES" button click via onTelegramCallbackQuery
    // -------------------------------------------------------------------------
    console.log('\n--- Test 12: Resolve Job 3 with YES button click ---');
    const job3MsgId = job3PromptMsg.messageId;
    await onTelegramCallbackQuery(
      {
        id: 'cb_query_3',
        data: `job:yes:${JOB_3_ID}`,
        message: {
          message_id: job3MsgId,
          chat: { id: TEST_CHAT_ID },
        },
      },
      {},
      {
        supabase,
        telegramSendFn: mockTelegramSend,
        telegramAnswerFn: mockTelegramAnswer,
        telegramEditMarkupFn: mockTelegramEditMarkup,
      }
    );

    const { data: app3 } = await supabase
      .from('applications')
      .select('*')
      .eq('profile_id', TEST_PROFILE_ID)
      .eq('job_id', JOB_3_ID)
      .single();
    assert(app3 !== null && app3.status === 'QUEUED', 'Application row created for Job 3 as QUEUED');

    // -------------------------------------------------------------------------
    // Test 13: Queue is now empty
    // -------------------------------------------------------------------------
    console.log('\n--- Test 13: Queue empty when all jobs processed ---');
    const advanceEmpty = await advanceConfirmationQueue(TEST_PROFILE_ID, {
      supabase,
      telegramSendFn: mockTelegramSend,
    });
    assert(advanceEmpty.status === 'queue_empty', 'advanceConfirmationQueue returned "queue_empty"');

    // -------------------------------------------------------------------------
    // Test 14: Inbound reply / callback with no pending job -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 14: Inbound reply with no pending job ignored ---');
    const pendingNone = await getPendingConfirmationJob(supabase, TEST_PROFILE_ID);
    assert(pendingNone === null, 'No pending confirmation job exists in DB');
    const countBefore = sentMessages.length;
    await onTelegramReply(TEST_CHAT_ID, { text: 'yes' }, {}, { supabase, telegramSendFn: mockTelegramSend });
    assert(sentMessages.length === countBefore, 'Inbound message ignored silently when no pending job exists');

    console.log('\n================================================================');
    console.log('  🎉 ALL Phase V1-A4 CHECKPOINT TESTS PASSED SUCCESSFULLY!       ');
    console.log('================================================================\n');
  } finally {
    await cleanupTestData(supabase);
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed with exception:', err);
  process.exit(1);
});
