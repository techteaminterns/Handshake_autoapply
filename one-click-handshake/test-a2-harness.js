/**
 * test-a2-harness.js
 *
 * Phase V1-A2 Checkpoint Test Harness
 *
 * Verifies:
 * 1. Onboarding API with has_existing_handshake_account = true:
 *    - profiles.handshake_email is stored correctly.
 *    - profiles.handshake_password_enc is stored as AES-256-GCM encrypted ciphertext.
 *    - Decrypting handshake_password_enc with decryptToken yields the original password.
 *    - API response returns { profile_id, resume_url } and never exposes handshake_password_enc.
 * 2. Onboarding API with has_existing_handshake_account = false:
 *    - profiles.handshake_email is null.
 *    - profiles.handshake_password_enc is null.
 * 3. Validation checks:
 *    - Missing handshake_email when has_existing_handshake_account = true -> 400.
 *    - Invalid handshake_email -> 400.
 *    - Missing handshake_password when has_existing_handshake_account = true -> 400.
 * 4. Client-role isolation:
 *    - Authenticated user client cannot select handshake_password_enc.
 *
 * Usage:
 *   node test-a2-harness.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from './lib/supabase/admin.js';
import { decryptToken } from './lib/crypto/tokenCipher.js';
import handler from './api/onboarding.js';

const TEST_USER_ID = '22222222-a2a2-2222-a2a2-222222222222';
const TEST_EMAIL = 'a2test.student@example.edu';
const TEST_PASSWORD = 'SecretTestPassword123!';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

/** Mock HTTP Response helper */
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

async function setupTestUser(admin) {
  console.log('\n[Setup] Resetting test user and profile...');
  await admin.from('resumes').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('profiles').delete().eq('id', TEST_USER_ID);
  try {
    await admin.auth.admin.deleteUser(TEST_USER_ID);
  } catch (_) {}

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    password: 'MockAuthPassword456!',
    email_confirm: true,
  });
  if (userError) throw userError;

  // Generate a valid JWT token for authenticated requests
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const authClient = createClient(supabaseUrl, anonKey);
  const { data: sessionData, error: signInError } = await authClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: 'MockAuthPassword456!',
  });
  if (signInError) throw signInError;

  return { token: sessionData.session.access_token, authClient };
}

async function cleanupTestUser(admin) {
  console.log('\n[Cleanup] Cleaning up test records...');
  await admin.from('resumes').delete().eq('profile_id', TEST_USER_ID);
  await admin.from('profiles').delete().eq('id', TEST_USER_ID);
  try {
    await admin.auth.admin.deleteUser(TEST_USER_ID);
  } catch (_) {}
}

async function runTests() {
  console.log('================================================================');
  console.log('  Phase V1-A2: Handshake Account Onboarding Checkpoint Tests    ');
  console.log('================================================================');

  const admin = createSupabaseAdmin();
  const { token, authClient } = await setupTestUser(admin);

  // Minimal 1x1 PDF dummy payload in base64
  const samplePdfBase64 = Buffer.from('%PDF-1.4 minimal test PDF content %%EOF').toString('base64');

  const baseValidPayload = {
    first_name: 'Test',
    last_name: 'Candidate',
    student_email: TEST_EMAIL,
    phone: '5551234567',
    school_name: 'Engineering Institute',
    major: 'Computer Science',
    degree_pursuing: "Bachelor's",
    grad_month: 'May',
    grad_year: 2026,
    school_additional_info: 'Honors program',
    job_types: ['full_time', 'internship'],
    locations_open_to: ['Remote', 'San Francisco, CA'],
    job_interests: ['Software Engineering', 'AI'],
    profile_visibility: 'community',
    job_alerts_opt_in: true,
    resume_base64: samplePdfBase64,
  };

  try {
    // -------------------------------------------------------------------------
    // Test 1: Validation - has_existing_handshake_account = true requires handshake_email
    // -------------------------------------------------------------------------
    console.log('\n--- Test 1: Validation: missing handshake_email ---');
    const req1 = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        ...baseValidPayload,
        has_existing_handshake_account: true,
        handshake_email: '',
        handshake_password: TEST_PASSWORD,
      },
    };
    const res1 = createMockRes();
    await handler(req1, res1);
    assert(res1.statusCode === 400, 'API returns 400 when handshake_email is missing');
    assert(res1.body.error.includes('handshake_email'), 'Error message specifies missing handshake_email');

    // -------------------------------------------------------------------------
    // Test 2: Validation - invalid handshake_email format
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Validation: invalid handshake_email format ---');
    const req2 = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        ...baseValidPayload,
        has_existing_handshake_account: true,
        handshake_email: 'not-an-email',
        handshake_password: TEST_PASSWORD,
      },
    };
    const res2 = createMockRes();
    await handler(req2, res2);
    assert(res2.statusCode === 400, 'API returns 400 when handshake_email is malformed');
    assert(res2.body.error.includes('valid email address'), 'Error message specifies valid email');

    // -------------------------------------------------------------------------
    // Test 3: Validation - missing handshake_password when account = true
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Validation: missing handshake_password ---');
    const req3 = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        ...baseValidPayload,
        has_existing_handshake_account: true,
        handshake_email: 'hs.user@example.edu',
        handshake_password: '',
      },
    };
    const res3 = createMockRes();
    await handler(req3, res3);
    assert(res3.statusCode === 400, 'API returns 400 when handshake_password is missing');
    assert(res3.body.error.includes('handshake_password'), 'Error message specifies missing handshake_password');

    // -------------------------------------------------------------------------
    // Test 4: Success - has_existing_handshake_account = true
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Submit onboarding with existing Handshake account ---');
    const req4 = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        ...baseValidPayload,
        has_existing_handshake_account: true,
        handshake_email: 'Hs.User@Example.EDU',
        handshake_password: TEST_PASSWORD,
      },
    };
    const res4 = createMockRes();
    await handler(req4, res4);

    assert(res4.statusCode === 200, 'API returns 200 on valid submission');
    assert(res4.body.profile_id === TEST_USER_ID, 'Response contains correct profile_id');
    assert(typeof res4.body.resume_url === 'string', 'Response contains signed resume_url');
    assert(res4.body.handshake_password_enc === undefined, 'handshake_password_enc is NEVER returned in response');
    assert(res4.body.handshake_password === undefined, 'handshake_password is NEVER returned in response');

    // Check DB row via admin client
    const { data: profile4, error: profErr4 } = await admin
      .from('profiles')
      .select('*')
      .eq('id', TEST_USER_ID)
      .single();
    if (profErr4) throw profErr4;

    assert(profile4.has_existing_handshake_account === true, 'profiles.has_existing_handshake_account is true');
    assert(profile4.handshake_email === 'hs.user@example.edu', 'profiles.handshake_email is stored lowercase');
    assert(profile4.handshake_password_enc !== null, 'profiles.handshake_password_enc is populated');
    assert(profile4.handshake_password_enc !== TEST_PASSWORD, 'handshake_password_enc is NOT stored in plaintext');

    // Verify AES-256-GCM decryption
    const decrypted4 = decryptToken(profile4.handshake_password_enc);
    assert(decrypted4 === TEST_PASSWORD, 'Decrypted ciphertext matches original plaintext password');

    // -------------------------------------------------------------------------
    // Test 5: Client-role read isolation on handshake_password_enc
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Client-role cannot select handshake_password_enc ---');
    const { data: clientProfile, error: clientErr } = await authClient
      .from('profiles')
      .select('id, handshake_email, handshake_password_enc')
      .eq('id', TEST_USER_ID)
      .maybeSingle();

    assert(
      clientErr !== null || clientProfile?.handshake_password_enc === undefined,
      'Client-role SELECT on handshake_password_enc is blocked'
    );

    // -------------------------------------------------------------------------
    // Test 6: Re-submit with has_existing_handshake_account = false
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Re-submit with has_existing_handshake_account = false ---');
    const req6 = {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        ...baseValidPayload,
        has_existing_handshake_account: false,
        handshake_email: null,
        handshake_password: null,
      },
    };
    const res6 = createMockRes();
    await handler(req6, res6);

    assert(res6.statusCode === 200, 'API returns 200 on re-submission with account=false');

    const { data: profile6 } = await admin
      .from('profiles')
      .select('*')
      .eq('id', TEST_USER_ID)
      .single();

    assert(profile6.has_existing_handshake_account === false, 'profiles.has_existing_handshake_account updated to false');
    assert(profile6.handshake_email === null, 'profiles.handshake_email is cleared to null');
    assert(profile6.handshake_password_enc === null, 'profiles.handshake_password_enc is cleared to null');

    console.log('\n================================================================');
    console.log('  🎉 ALL Phase V1-A2 CHECKPOINT TESTS PASSED SUCCESSFULLY!       ');
    console.log('================================================================\n');
  } finally {
    await cleanupTestUser(admin);
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed with exception:', err);
  process.exit(1);
});
