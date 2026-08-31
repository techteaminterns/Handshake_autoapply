/**
 * test-a4-harness.js
 *
 * Phase V1-A4 Checkpoint Test Harness
 *
 * Validates the complete Telegram confirmation flow against the test matrix:
 * 1. Format verification: prompt text contains job title, company, url, and YES/NO prompt.
 * 2. Send utility & queue advance:
 *    - Prompts oldest unconfirmed job.
 *    - Enforces 1 pending prompt at a time (does not send second prompt while first is pending).
 * 3. Webhook reply parsing & state machine:
 *    - Reply "yes" -> creates QUEUED application row, stamps resolved_at, auto-advances to next job.
 *    - Reply "no" -> creates REJECTED application row, stamps resolved_at.
 *    - Unrecognized reply ("maybe") -> sends reprompt, leaves prompt open.
 *    - Duplicate reply -> ignored (prompt already resolved).
 *    - Reply with no pending job -> ignored silently (logged).
 *    - Permanent rejection -> cannot be queued later.
 * 4. Multi-job sequence:
 *    - Inserts 3 jobs, verifies they are prompted sequentially one by one upon reply.
 *
 * Usage:
 *   node test-a4-harness.js
 */

import 'dotenv/config';
import { createSupabaseAdmin } from './lib/supabase/admin.js';
import {
  formatJobConfirmationMessage,
  getPendingConfirmationJob,
  getNextJobAwaitingPrompt,
  sendJobConfirmation,
  advanceConfirmationQueue,
  resolvePendingConfirmation,
} from './lib/telegram/jobConfirmation.js';
import { onTelegramReply } from './api/telegram/webhook.js';

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
  console.log('  Phase V1-A4: Telegram Job Confirmation Checkpoint Test Suite  ');
  console.log('================================================================');

  const supabase = createSupabaseAdmin();
  await setupTestData(supabase);

  // Mock Telegram send to capture outgoing messages
  const sentMessages = [];
  const mockTelegramSend = async (chatId, text, options) => {
    sentMessages.push({ chatId, text, options, timestamp: new Date() });
    return { ok: true, result: { message_id: sentMessages.length + 100, text } };
  };

  try {
    // -------------------------------------------------------------------------
    // Test 1: Message Formatting
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: formatJobConfirmationMessage ---');
    const sampleJob = {
      title: 'Full Stack Engineer',
      company: 'Acme Systems',
      url: 'https://app.joinhandshake.com/jobs/12345',
    };
    const formatted = formatJobConfirmationMessage(sampleJob);
    assert(formatted.includes('Apply to Full Stack Engineer at Acme Systems?'), 'Formatted text contains title and company');
    assert(formatted.includes('https://app.joinhandshake.com/jobs/12345'), 'Formatted text contains job URL');
    assert(formatted.includes('Reply YES to queue or NO to skip.'), 'Formatted text contains YES/NO instructions');

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
    // Test 3: Advance Queue -> Prompts Oldest Job (Job 1)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: advanceConfirmationQueue prompts oldest job ---');
    const advance1 = await advanceConfirmationQueue(TEST_PROFILE_ID, {
      supabase,
      telegramSendFn: mockTelegramSend,
    });
    assert(advance1.status === 'sent', 'advanceConfirmationQueue returned status "sent"');
    assert(advance1.job.id === JOB_1_ID, 'Prompted oldest job (Job 1)');
    assert(sentMessages.length === 1, 'Exactly one Telegram message sent');
    assert(sentMessages[0].text.includes('Junior SWE at Alpha Inc'), 'Message text matches Job 1');

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
    // Test 5: Unrecognized Reply ("maybe") -> Reprompt without closing
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Unrecognized reply ("maybe") reprompts user ---');
    await onTelegramReply(TEST_CHAT_ID, { text: 'maybe later' }, {}, { supabase, telegramSendFn: mockTelegramSend });
    assert(sentMessages.length === 2, 'Sent reprompt message for unrecognized reply');
    assert(sentMessages[1].text.includes('Please reply YES to queue this application or NO to skip.'), 'Reprompt content matched');

    // Verify job is STILL pending
    const stillPending = await getPendingConfirmationJob(supabase, TEST_PROFILE_ID);
    assert(stillPending !== null && stillPending.id === JOB_1_ID, 'Job 1 is still pending');

    // -------------------------------------------------------------------------
    // Test 6: Inbound reply from unknown / unlinked chat_id -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Unlinked chat_id ignored silently ---');
    const initialMsgCount = sentMessages.length;
    await onTelegramReply(999999999, { text: 'yes' }, {}, { supabase, telegramSendFn: mockTelegramSend });
    assert(sentMessages.length === initialMsgCount, 'No reply sent to unknown chat_id');

    // -------------------------------------------------------------------------
    // Test 7: User replies "YES" to Job 1 via webhook -> QUEUED Application + Auto-advance to Job 2
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: User replies "YES" to Job 1 via webhook onTelegramReply ---');
    await onTelegramReply(TEST_CHAT_ID, { text: 'yes' }, {}, { supabase, telegramSendFn: mockTelegramSend });

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

    // Verify Job 2 was automatically prompted via advanceConfirmationQueue in webhook
    assert(sentMessages.some((m) => m.text.includes('Backend Dev at Beta LLC')), 'Job 2 auto-prompted after YES reply');

    // -------------------------------------------------------------------------
    // Test 8: Duplicate reply to resolved Job 1 -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Duplicate reply to resolved job ignored ---');
    const duplicateResolve = await resolvePendingConfirmation(TEST_PROFILE_ID, JOB_1_ID, 'yes', { supabase });
    assert(duplicateResolve.status === 'ignored_duplicate', 'Duplicate reply returned "ignored_duplicate"');

    // -------------------------------------------------------------------------
    // Test 9: Active unconfirmed job is now Job 2
    // -------------------------------------------------------------------------
    console.log('\n--- Test 9: Active unconfirmed job is now Job 2 ---');
    const pendingJob2 = await getPendingConfirmationJob(supabase, TEST_PROFILE_ID);
    assert(pendingJob2 !== null && pendingJob2.id === JOB_2_ID, 'Pending job is now Job 2');

    // -------------------------------------------------------------------------
    // Test 10: User replies "NO" to Job 2 via webhook -> REJECTED Application + Auto-advance to Job 3
    // -------------------------------------------------------------------------
    console.log('\n--- Test 10: User replies "NO" to Job 2 via webhook ---');
    await onTelegramReply(TEST_CHAT_ID, { text: 'no' }, {}, { supabase, telegramSendFn: mockTelegramSend });

    const { data: app2 } = await supabase
      .from('applications')
      .select('*')
      .eq('profile_id', TEST_PROFILE_ID)
      .eq('job_id', JOB_2_ID)
      .single();
    assert(app2 !== null, 'Application row created for Job 2');
    assert(app2.status === 'REJECTED', 'Application status is REJECTED');
    assert(app2.finished_at !== null, 'Application finished_at is populated');

    // Verify Job 3 was auto-prompted
    assert(sentMessages.some((m) => m.text.includes('ML Engineer at Gamma AI')), 'Job 3 auto-prompted after NO reply');

    // -------------------------------------------------------------------------
    // Test 11: Late "YES" reply on permanently REJECTED Job 2 -> Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- Test 11: Late YES on previously REJECTED job blocked ---');
    // Temporarily clear resolved_at on job 2 to test race condition
    await supabase.from('handshake_jobs').update({ telegram_prompt_resolved_at: null }).eq('id', JOB_2_ID);
    const rejectRetry = await resolvePendingConfirmation(TEST_PROFILE_ID, JOB_2_ID, 'yes', { supabase });
    assert(rejectRetry.status === 'ignored_permanent_reject', 'Permanent reject honored (returned "ignored_permanent_reject")');
    await supabase.from('handshake_jobs').update({ telegram_prompt_resolved_at: new Date().toISOString() }).eq('id', JOB_2_ID);

    // -------------------------------------------------------------------------
    // Test 12: Resolve Job 3 with YES via webhook
    // -------------------------------------------------------------------------
    console.log('\n--- Test 12: Resolve Job 3 with YES via webhook ---');
    await onTelegramReply(TEST_CHAT_ID, { text: 'yes' }, {}, { supabase, telegramSendFn: mockTelegramSend });

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
    // Test 14: Reply with no pending job -> Ignored
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
