/**
 * test-a3-harness.js
 *
 * Phase V1-A3 Checkpoint Test Harness
 *
 * Verifies:
 * 1. GET /api/applications:
 *    - Returns applications list with joined handshake_jobs title, company, url.
 *    - Scoped strictly to profile_id = auth.uid().
 * 2. GET /api/interventions/open:
 *    - Returns null when no open interventions exist.
 *    - Returns topmost OPEN intervention when created.
 * 3. POST /api/interventions/:id/resolve (and /api/interventions/resolve):
 *    - Resolves OTP intervention with numeric code.
 *    - Resolves EMAIL_CONFIRM intervention with "confirmed".
 *    - Resolves UNKNOWN_QUESTION intervention with answer text.
 *    - Resolves AUTH intervention with "ready".
 *    - Sets status = 'RESOLVED', stamps resolved_at, stores answer.
 *    - Blocks non-owner from resolving intervention.
 *
 * Usage:
 *   node test-a3-harness.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from './lib/supabase/admin.js';
import applicationsHandler from './api/applications.js';
import openInterventionsHandler from './api/interventions/open.js';
import resolveInterventionHandler from './api/interventions/[id]/resolve.js';

const TEST_USER_ID_A = '33333333-a3a3-3333-a3a3-333333333333';
const TEST_EMAIL_A = 'a3test.user.a@example.edu';

const TEST_USER_ID_B = '33333333-b3b3-3333-b3b3-333333333333';
const TEST_EMAIL_B = 'a3test.user.b@example.edu';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { res.headers[k] = v; return res; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
    end() { return res; },
  };
  return res;
}

async function setupUser(admin, userId, email) {
  await admin.from('interventions').delete().eq('profile_id', userId);
  await admin.from('applications').delete().eq('profile_id', userId);
  await admin.from('handshake_jobs').delete().eq('profile_id', userId);
  await admin.from('profiles').delete().eq('id', userId);

  try {
    await admin.auth.admin.deleteUser(userId);
  } catch (_) {}

  await admin.auth.admin.createUser({
    id: userId,
    email: email,
    password: 'MockAuthPassword789!',
    email_confirm: true,
  });

  await admin.from('profiles').insert({
    id: userId,
    first_name: 'Test',
    last_name: 'User',
    student_email: email,
    phone: '5550001111',
    school_name: 'Tech University',
    major: 'Computer Science',
    degree_pursuing: "Bachelor's",
    grad_month: 'May',
    grad_year: 2026,
    has_existing_handshake_account: false,
  });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  const client = createClient(supabaseUrl, anonKey);
  const { data: sessionData, error: signInErr } = await client.auth.signInWithPassword({
    email: email,
    password: 'MockAuthPassword789!',
  });
  if (signInErr) throw signInErr;

  return { token: sessionData.session.access_token, client };
}

async function cleanupUser(admin, userId) {
  await admin.from('interventions').delete().eq('profile_id', userId);
  await admin.from('applications').delete().eq('profile_id', userId);
  await admin.from('handshake_jobs').delete().eq('profile_id', userId);
  await admin.from('profiles').delete().eq('id', userId);
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch (_) {}
}

async function runTests() {
  console.log('================================================================');
  console.log('  Phase V1-A3: Monitoring UI & Interventions Checkpoint Tests   ');
  console.log('================================================================');

  const admin = createSupabaseAdmin();
  const userA = await setupUser(admin, TEST_USER_ID_A, TEST_EMAIL_A);
  const userB = await setupUser(admin, TEST_USER_ID_B, TEST_EMAIL_B);

  try {
    // -------------------------------------------------------------------------
    // Test 1: GET /api/applications when empty
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: GET /api/applications (empty queue) ---');
    const req1 = { method: 'GET', headers: { authorization: `Bearer ${userA.token}` } };
    const res1 = createMockRes();
    await applicationsHandler(req1, res1);

    assert(res1.statusCode === 200, 'Applications API returns 200');
    assert(Array.isArray(res1.body.applications), 'Response contains applications array');
    assert(res1.body.applications.length === 0, 'Applications array is empty initially');

    // -------------------------------------------------------------------------
    // Test 2: GET /api/applications with seeded jobs & applications
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: GET /api/applications (with active & queued jobs) ---');
    const { data: job1, error: j1Err } = await admin.from('handshake_jobs').insert({
      profile_id: TEST_USER_ID_A,
      title: 'Frontend Engineer',
      company: 'Acme Corp',
      location: 'San Francisco, CA',
      url: 'https://app.joinhandshake.com/jobs/99001',
      has_quick_apply: true,
    }).select().single();
    if (j1Err) console.error('j1Err:', j1Err);

    const { data: job2, error: j2Err } = await admin.from('handshake_jobs').insert({
      profile_id: TEST_USER_ID_A,
      title: 'Fullstack Developer',
      company: 'Beta LLC',
      location: 'Remote',
      url: 'https://app.joinhandshake.com/jobs/99002',
      has_quick_apply: true,
    }).select().single();
    if (j2Err) console.error('j2Err:', j2Err);

    const { data: insApps, error: insErr } = await admin.from('applications').insert([
      {
        profile_id: TEST_USER_ID_A,
        job_id: job1.id,
        status: 'PROCESSING',
        current_step: 'quick_apply',
        queued_at: new Date(Date.now() - 2000).toISOString(),
        started_at: new Date().toISOString(),
      },
      {
        profile_id: TEST_USER_ID_A,
        job_id: job2.id,
        status: 'QUEUED',
        queued_at: new Date(Date.now() - 1000).toISOString(),
      },
    ]).select();
    if (insErr) console.error('insErr:', insErr);

    const req2 = { method: 'GET', headers: { authorization: `Bearer ${userA.token}` } };
    const res2 = createMockRes();
    await applicationsHandler(req2, res2);

    assert(res2.statusCode === 200, 'Applications API returns 200');
    assert(res2.body.applications.length === 2, 'Returns 2 application rows');

    const appItem1 = res2.body.applications.find(a => a.job_id === job1.id);
    assert(appItem1 !== undefined, 'Found application for job 1');
    assert(appItem1.title === 'Frontend Engineer', 'Joined job title matches');
    assert(appItem1.company === 'Acme Corp', 'Joined job company matches');
    assert(appItem1.url === 'https://app.joinhandshake.com/jobs/99001', 'Joined job url matches');
    assert(appItem1.status === 'PROCESSING', 'Status matches PROCESSING');
    assert(appItem1.current_step === 'quick_apply', 'Current step matches quick_apply');

    // -------------------------------------------------------------------------
    // Test 3: GET /api/interventions/open (empty vs open)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: GET /api/interventions/open ---');
    const req3a = { method: 'GET', headers: { authorization: `Bearer ${userA.token}` } };
    const res3a = createMockRes();
    await openInterventionsHandler(req3a, res3a);

    assert(res3a.statusCode === 200, 'Interventions API returns 200');
    assert(res3a.body.intervention === null, 'Returns null when no open intervention exists');

    // Insert OPEN OTP intervention
    const { data: otpInt } = await admin.from('interventions').insert({
      profile_id: TEST_USER_ID_A,
      type: 'OTP',
      question_text: 'student.email@school.edu',
      status: 'OPEN',
    }).select().single();

    const res3b = createMockRes();
    await openInterventionsHandler(req3a, res3b);
    assert(res3b.statusCode === 200, 'Interventions API returns 200');
    assert(res3b.body.intervention?.id === otpInt.id, 'Returns newly inserted OPEN intervention');
    assert(res3b.body.intervention?.type === 'OTP', 'Intervention type is OTP');

    // -------------------------------------------------------------------------
    // Test 4: POST /api/interventions/:id/resolve (OTP)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Resolve OTP Intervention ---');
    const req4 = {
      method: 'POST',
      headers: { authorization: `Bearer ${userA.token}` },
      query: { id: otpInt.id },
      body: { answer: '654321' },
    };
    const res4 = createMockRes();
    await resolveInterventionHandler(req4, res4);

    assert(res4.statusCode === 200, 'Resolve API returns 200 for OTP');
    assert(res4.body.ok === true, 'Resolve response ok is true');
    assert(res4.body.intervention?.status === 'RESOLVED', 'Returned intervention status is RESOLVED');
    assert(res4.body.intervention?.answer === '654321', 'Returned intervention answer is 654321');

    const { data: dbInt4 } = await admin.from('interventions').select('*').eq('id', otpInt.id).single();
    assert(dbInt4.status === 'RESOLVED', 'DB intervention status is RESOLVED');
    assert(dbInt4.answer === '654321', 'DB intervention answer is saved');
    assert(dbInt4.resolved_at !== null, 'DB intervention resolved_at is stamped');

    // -------------------------------------------------------------------------
    // Test 5: Resolve EMAIL_CONFIRM, UNKNOWN_QUESTION, and AUTH interventions
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Resolve EMAIL_CONFIRM, UNKNOWN_QUESTION, AUTH ---');

    // 5a. EMAIL_CONFIRM
    const { data: emailInt } = await admin.from('interventions').insert({
      profile_id: TEST_USER_ID_A,
      type: 'EMAIL_CONFIRM',
      status: 'OPEN',
    }).select().single();

    const req5a = {
      method: 'POST',
      headers: { authorization: `Bearer ${userA.token}` },
      query: { id: emailInt.id },
      body: { answer: 'confirmed' },
    };
    const res5a = createMockRes();
    await resolveInterventionHandler(req5a, res5a);
    assert(res5a.statusCode === 200, 'EMAIL_CONFIRM resolved successfully');

    // 5b. UNKNOWN_QUESTION
    const { data: uqInt } = await admin.from('interventions').insert({
      profile_id: TEST_USER_ID_A,
      type: 'UNKNOWN_QUESTION',
      question_text: 'Are you legally authorized to work in the United States?',
      options: ['Yes', 'No'],
      status: 'OPEN',
    }).select().single();

    const req5b = {
      method: 'POST',
      headers: { authorization: `Bearer ${userA.token}` },
      query: { id: uqInt.id },
      body: { answer: 'Yes' },
    };
    const res5b = createMockRes();
    await resolveInterventionHandler(req5b, res5b);
    assert(res5b.statusCode === 200, 'UNKNOWN_QUESTION resolved successfully');
    assert(res5b.body.intervention?.answer === 'Yes', 'UNKNOWN_QUESTION answer stored');

    // 5c. AUTH
    const { data: authInt } = await admin.from('interventions').insert({
      profile_id: TEST_USER_ID_A,
      type: 'AUTH',
      status: 'OPEN',
    }).select().single();

    const req5c = {
      method: 'POST',
      headers: { authorization: `Bearer ${userA.token}` },
      query: { id: authInt.id },
      body: { answer: 'ready' },
    };
    const res5c = createMockRes();
    await resolveInterventionHandler(req5c, res5c);
    assert(res5c.statusCode === 200, 'AUTH resolved successfully');
    assert(res5c.body.intervention?.answer === 'ready', 'AUTH answer stored');

    // -------------------------------------------------------------------------
    // Test 6: Cross-user isolation (User B cannot resolve User A's intervention)
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Cross-user isolation ---');
    const { data: userAInt } = await admin.from('interventions').insert({
      profile_id: TEST_USER_ID_A,
      type: 'OTP',
      status: 'OPEN',
    }).select().single();

    const req6 = {
      method: 'POST',
      headers: { authorization: `Bearer ${userB.token}` },
      query: { id: userAInt.id },
      body: { answer: '999999' },
    };
    const res6 = createMockRes();
    await resolveInterventionHandler(req6, res6);

    assert(res6.statusCode === 404, 'User B receives 404 attempting to resolve User A intervention');

    console.log('\n================================================================');
    console.log('  🎉 ALL Phase V1-A3 CHECKPOINT TESTS PASSED SUCCESSFULLY!       ');
    console.log('================================================================\n');
  } finally {
    console.log('[Cleanup] Cleaning up test records...');
    await cleanupUser(admin, TEST_USER_ID_A);
    await cleanupUser(admin, TEST_USER_ID_B);
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed with exception:', err);
  process.exit(1);
});
