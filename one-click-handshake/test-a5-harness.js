/**
 * test-a5-harness.js
 *
 * Phase V1-A5 Checkpoint Test Harness
 *
 * Verifies all 8 Side A interface functions:
 * 1. getProfile:
 *    - Returns normalized profile with all expected fields.
 *    - Throws profile_not_found for invalid UUID.
 * 2. getResumeUrl:
 *    - Generates signed Storage URL for user's resume.
 *    - Throws resume_not_found if no resume exists.
 * 3. claimNextJob:
 *    - Atomic concurrency: two simultaneous claimNextJob calls -> exactly one gets the job, one gets null.
 *    - Empty queue returns null.
 * 4. markJobStatus:
 *    - Updates application status & current_step, timestamps submitted_at/finished_at.
 *    - Inserts audit row in application_events.
 *    - Enforces DB status transition rules (throws on illegal transition).
 * 5. createIntervention:
 *    - Creates OPEN intervention row; validates allowed types.
 * 6. resolveIntervention:
 *    - Polls on 2s interval until RESOLVED, returns answer string.
 *    - Throws intervention_timeout if not resolved before timeout.
 * 7. storeJobsFromScrape:
 *    - Dedups by (profile_id, url) and returns new job count.
 *    - Re-scrape with existing URLs returns 0 new jobs.
 * 8. checkAndIncrementActionCount:
 *    - Atomic rate-limiting: returns true for 300 increments, returns false on 301st call.
 * 9. CommonJS Bridge (bot/src/stubs/sideA.js):
 *    - Verifies CJS wrapper seamlessly calls ESM worker/sideA.js.
 *
 * Usage:
 *   node test-a5-harness.js
 */

import 'dotenv/config';
import { createSupabaseAdmin } from './lib/supabase/admin.js';
import {
  getProfile,
  getResumeUrl,
  claimNextJob,
  markJobStatus,
  createIntervention,
  resolveIntervention,
  storeJobsFromScrape,
  checkAndIncrementActionCount,
} from './worker/sideA.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cjsSideA = require('./bot/src/stubs/sideA.js');

const TEST_USER_ID = '55555555-a5a5-5555-a5a5-555555555555';
const TEST_EMAIL = 'a5test.user@example.edu';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function setupTestUser(admin) {
  // Clean up existing records
  await admin.from('profile_daily_action_counts').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('application_events').delete().filter('application_id', 'in', `(select id from applications where profile_id = '${TEST_USER_ID}')`);
  await admin.from('interventions').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('applications').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('handshake_jobs').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('resumes').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('profiles').delete().eq('id', TEST_USER_ID);

  try {
    await admin.auth.admin.deleteUser(TEST_USER_ID);
  } catch (_) {}

  await admin.auth.admin.createUser({
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    password: 'MockPassword123!',
    email_confirm: true,
  });

  const { data: profile, error: pErr } = await admin.from('profiles').insert({
    id: TEST_USER_ID,
    first_name: 'Antigravity',
    last_name: 'Tester',
    student_email: TEST_EMAIL,
    phone: '5551234567',
    school_name: 'Stanford University',
    major: 'Computer Science',
    degree_pursuing: "Master's",
    grad_month: 'June',
    grad_year: 2026,
    school_additional_info: 'GPA: 3.9',
    job_types: ['full_time', 'internship'],
    locations_open_to: ['San Francisco, CA', 'Remote'],
    job_interests: ['Software Engineer', 'ML Engineer'],
    profile_visibility: 'community',
    job_alerts_opt_in: true,
    has_existing_handshake_account: true,
    handshake_email: 'antigravity@stanford.edu',
    telegram_chat_id: '123456789',
  }).select().single();

  if (pErr) {
    console.error('setupTestUser profiles insert error:', pErr);
    throw pErr;
  }

  return profile;
}

async function cleanupTestUser(admin) {
  await admin.from('profile_daily_action_counts').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('interventions').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('applications').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('handshake_jobs').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('resumes').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('profiles').delete().eq('id', TEST_USER_ID);
  try {
    await admin.auth.admin.deleteUser(TEST_USER_ID);
  } catch (_) {}
}

async function runTests() {
  console.log('================================================================');
  console.log('  Phase V1-A5: Side A Interface Functions Checkpoint Tests      ');
  console.log('================================================================');

  const admin = createSupabaseAdmin();
  await setupTestUser(admin);

  try {
    // -------------------------------------------------------------------------
    // Test 1: getProfile
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: getProfile ---');
    const profile = await getProfile(TEST_USER_ID);
    assert(profile.id === TEST_USER_ID, 'Profile ID matches');
    assert(profile.first_name === 'Antigravity', 'First name matches');
    assert(profile.last_name === 'Tester', 'Last name matches');
    assert(profile.student_email === TEST_EMAIL, 'Student email matches');
    assert(profile.degree_pursuing === "Master's", 'Degree matches');
    assert(Array.isArray(profile.job_types) && profile.job_types.length === 2, 'Job types array matches');
    assert(profile.handshake_email === 'antigravity@stanford.edu', 'Handshake email matches');
    assert(profile.handshake_password_enc === undefined, 'handshake_password_enc is NOT returned');

    let notFoundErr = null;
    try {
      await getProfile('00000000-0000-0000-0000-000000000000');
    } catch (e) {
      notFoundErr = e;
    }
    assert(notFoundErr && notFoundErr.message.includes('profile_not_found'), 'Throws profile_not_found for missing user');

    // -------------------------------------------------------------------------
    // Test 2: getResumeUrl
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: getResumeUrl ---');
    let noResumeErr = null;
    try {
      await getResumeUrl(TEST_USER_ID);
    } catch (e) {
      noResumeErr = e;
    }
    assert(noResumeErr && noResumeErr.message.includes('resume_not_found'), 'Throws resume_not_found when no resume is uploaded');

    // Upload dummy resume to Storage bucket 'resumes'
    const dummyPath = `${TEST_USER_ID}/test_resume.pdf`;
    const dummyContent = Buffer.from('%PDF-1.4 Mock resume content for testing');
    await admin.storage.from('resumes').upload(dummyPath, dummyContent, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { error: resErr } = await admin.from('resumes').insert({
      profile_id: TEST_USER_ID,
      storage_path: dummyPath,
      file_size_bytes: dummyContent.length,
    });
    if (resErr) {
      console.error('resumes insert error:', resErr);
      throw resErr;
    }

    const signedUrl = await getResumeUrl(TEST_USER_ID);
    assert(typeof signedUrl === 'string' && signedUrl.startsWith('http'), 'Returns valid signed HTTP URL string');
    assert(signedUrl.includes('test_resume.pdf'), 'Signed URL references correct resume file');

    // -------------------------------------------------------------------------
    // Test 3: storeJobsFromScrape
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: storeJobsFromScrape (Deduplication) ---');
    const jobsBatch1 = [
      {
        url: 'https://app.joinhandshake.com/jobs/80001',
        title: 'Backend Engineer',
        company: 'Stripe',
        location: 'San Francisco, CA',
        has_quick_apply: true,
      },
      {
        url: 'https://app.joinhandshake.com/jobs/80002',
        title: 'Fullstack Engineer',
        company: 'Vercel',
        location: 'Remote',
        has_quick_apply: true,
      },
      {
        url: 'https://app.joinhandshake.com/jobs/80003',
        title: 'Systems Engineer',
        company: 'Cloudflare',
        location: 'Austin, TX',
        has_quick_apply: false,
      },
    ];

    const insertedCount1 = await storeJobsFromScrape(TEST_USER_ID, jobsBatch1);
    assert(insertedCount1 === 3, 'Batch 1 inserted 3 brand new jobs');

    // Scrape again with 2 existing + 1 new
    const jobsBatch2 = [
      jobsBatch1[0],
      jobsBatch1[1],
      {
        url: 'https://app.joinhandshake.com/jobs/80004',
        title: 'AI Engineer',
        company: 'Anthropic',
        location: 'San Francisco, CA',
        has_quick_apply: true,
      },
    ];

    const insertedCount2 = await storeJobsFromScrape(TEST_USER_ID, jobsBatch2);
    assert(insertedCount2 === 1, 'Batch 2 detected 2 duplicate URLs and inserted exactly 1 new job');

    const duplicateReplay = await storeJobsFromScrape(TEST_USER_ID, jobsBatch1);
    assert(duplicateReplay === 0, 'Re-scraping all existing jobs returns 0 new jobs');

    // -------------------------------------------------------------------------
    // Test 4: claimNextJob (Atomic Concurrency Test)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: claimNextJob (Atomic FOR UPDATE SKIP LOCKED) ---');
    // Fetch inserted job IDs
    const { data: dbJobs } = await admin
      .from('handshake_jobs')
      .select('id, url')
      .eq('profile_id', TEST_USER_ID)
      .order('discovered_at', { ascending: true });

    // Seed 1 QUEUED application
    const { data: seededApp } = await admin.from('applications').insert({
      profile_id: TEST_USER_ID,
      job_id: dbJobs[0].id,
      status: 'QUEUED',
      priority: 10,
      queued_at: new Date().toISOString(),
    }).select().single();

    // Call claimNextJob 2x SIMULTANEOUSLY
    const [claim1, claim2] = await Promise.all([
      claimNextJob(TEST_USER_ID, 'worker-A'),
      claimNextJob(TEST_USER_ID, 'worker-B'),
    ]);

    const winner = claim1 || claim2;
    const loser = claim1 && claim2 ? 'both_claimed' : (claim1 ? claim2 : claim1);

    assert(winner !== null, 'One worker successfully claimed the job');
    assert(loser === null, 'Second simultaneous claim returned null');
    assert(winner.id === seededApp.id, 'Claimed application ID matches seeded row');
    assert(winner.status === 'PROCESSING', 'Claimed application status updated to PROCESSING');
    assert(winner.worker_id === 'worker-A' || winner.worker_id === 'worker-B', 'Worker ID recorded');
    assert(winner.lock_acquired_at !== null, 'Lock acquisition timestamp set');

    const emptyClaim = await claimNextJob(TEST_USER_ID, 'worker-C');
    assert(emptyClaim === null, 'claimNextJob on empty queue returns null');

    // -------------------------------------------------------------------------
    // Test 5: markJobStatus (Status transitions & Audit events)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: markJobStatus ---');
    // PROCESSING -> SUBMITTING
    await markJobStatus(winner.id, 'SUBMITTING', 'submit');
    const { data: appSubmitting } = await admin.from('applications').select('*').eq('id', winner.id).single();
    assert(appSubmitting.status === 'SUBMITTING', 'Status transitioned to SUBMITTING');
    assert(appSubmitting.current_step === 'submit', 'Current step updated to submit');

    // SUBMITTING -> SUBMITTED
    await markJobStatus(winner.id, 'SUBMITTED', 'verify');
    const { data: appSubmitted } = await admin.from('applications').select('*').eq('id', winner.id).single();
    assert(appSubmitted.status === 'SUBMITTED', 'Status transitioned to SUBMITTED');
    assert(appSubmitted.current_step === 'verify', 'Current step updated to verify');
    assert(appSubmitted.submitted_at !== null, 'submitted_at is stamped');
    assert(appSubmitted.finished_at !== null, 'finished_at is stamped');

    // Check application_events audit trail
    const { data: auditEvents } = await admin
      .from('application_events')
      .select('*')
      .eq('application_id', winner.id)
      .order('created_at', { ascending: true });

    assert(auditEvents.length >= 2, 'Audit events recorded in application_events');
    assert(auditEvents.some(e => e.event_type === 'submitting'), 'Audit event for submitting exists');
    assert(auditEvents.some(e => e.event_type === 'submitted'), 'Audit event for submitted exists');

    // Terminal state violation: SUBMITTED -> QUEUED must throw
    let illegalTransitionErr = null;
    try {
      await markJobStatus(winner.id, 'QUEUED');
    } catch (e) {
      illegalTransitionErr = e;
    }
    assert(illegalTransitionErr !== null, 'Illegal transition from terminal SUBMITTED state throws DB error');

    // -------------------------------------------------------------------------
    // Test 6: createIntervention & resolveIntervention
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: createIntervention & resolveIntervention ---');
    const interventionId = await createIntervention(
      TEST_USER_ID,
      'UNKNOWN_QUESTION',
      winner.id,
      'Are you willing to relocate?',
      ['Yes', 'No', 'Negotiable']
    );

    assert(typeof interventionId === 'string' && interventionId.length > 20, 'Created intervention returned UUID');

    const { data: intRow } = await admin.from('interventions').select('*').eq('id', interventionId).single();
    assert(intRow.status === 'OPEN', 'Intervention status is OPEN');
    assert(intRow.type === 'UNKNOWN_QUESTION', 'Intervention type is UNKNOWN_QUESTION');
    assert(Array.isArray(intRow.options) && intRow.options.length === 3, 'Intervention options JSON stored');

    // Start resolveIntervention in background
    const resolvePromise = resolveIntervention(interventionId, 10000);

    // Simulate user answering after 1 second
    setTimeout(async () => {
      await admin.from('interventions').update({
        status: 'RESOLVED',
        answer: 'Yes',
        resolved_at: new Date().toISOString(),
      }).eq('id', interventionId);
    }, 1000);

    const receivedAnswer = await resolvePromise;
    assert(receivedAnswer === 'Yes', 'resolveIntervention poll resolved and returned the user answer "Yes"');

    // Test resolveIntervention timeout
    const timeoutIntId = await createIntervention(TEST_USER_ID, 'OTP', winner.id, 'test_otp');
    let timeoutErr = null;
    try {
      // 1.5s timeout (less than the 2s poll)
      await resolveIntervention(timeoutIntId, 1500);
    } catch (e) {
      timeoutErr = e;
    }
    assert(timeoutErr && timeoutErr.message.includes('intervention_timeout'), 'resolveIntervention throws intervention_timeout upon expiry');

    // -------------------------------------------------------------------------
    // Test 7: checkAndIncrementActionCount (300/day limit)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: checkAndIncrementActionCount (300 Actions/Day Limit) ---');
    // Call 1
    const allowed1 = await checkAndIncrementActionCount(TEST_USER_ID);
    assert(allowed1 === true, 'First action increment allowed (returns true)');

    // Directly advance count to 299 for performance
    const todayUTC = new Date().toISOString().split('T')[0];
    await admin.from('profile_daily_action_counts')
      .update({ count: 299 })
      .eq('profile_id', TEST_USER_ID)
      .eq('date', todayUTC);

    // Call 300 (299 -> 300)
    const allowed300 = await checkAndIncrementActionCount(TEST_USER_ID);
    assert(allowed300 === true, '300th action increment allowed (returns true)');

    const { data: countRow300 } = await admin.from('profile_daily_action_counts')
      .select('count')
      .eq('profile_id', TEST_USER_ID)
      .eq('date', todayUTC)
      .single();
    assert(countRow300.count === 300, 'Count reached 300 in DB');

    // Call 301 (at 300 cap -> blocked)
    const allowed301 = await checkAndIncrementActionCount(TEST_USER_ID);
    assert(allowed301 === false, '301st action blocked by rate limit (returns false)');

    const { data: countRow301 } = await admin.from('profile_daily_action_counts')
      .select('count')
      .eq('profile_id', TEST_USER_ID)
      .eq('date', todayUTC)
      .single();
    assert(countRow301.count === 300, 'Count remained unchanged at 300');

    // -------------------------------------------------------------------------
    // Test 8: CommonJS Bridge (bot/src/stubs/sideA.js)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: CommonJS Bridge (bot/src/stubs/sideA.js) ---');
    const bridgeProfile = await cjsSideA.getProfile(TEST_USER_ID);
    assert(bridgeProfile.id === TEST_USER_ID, 'CommonJS bridge getProfile succeeds');
    assert(bridgeProfile.first_name === 'Antigravity', 'CommonJS bridge data matches');

    console.log('\n================================================================');
    console.log('  🎉 ALL Phase V1-A5 CHECKPOINT TESTS PASSED SUCCESSFULLY!       ');
    console.log('================================================================\n');
  } finally {
    console.log('[Cleanup] Cleaning up test records...');
    await cleanupTestUser(admin);
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed with exception:', err);
  process.exit(1);
});
