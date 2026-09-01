/**
 * POST /api/onboarding
 *
 * Creates or updates a user's profile, handles resume storage (<1MB PDF),
 * creates a resumes table record, and returns the signed resume URL.
 *
 * Auth   : Supabase JWT — Bearer token in the Authorization header.
 * DB     : Uses anon key + user JWT so RLS enforces `profile_id = auth.uid()`
 *          on all writes. Service role is NOT used here.
 * Resume : Accepts either:
 *          1) `resume_base64` (server-side upload directly to 'resumes' bucket)
 *          2) `resume_storage_path` + `resume_file_size_bytes` (pre-uploaded client-side)
 *          Enforces < 1MB (1,048,576 bytes) and PDF format.
 *
 * Response 200 : { profile_id: string, resume_url: string }
 * Response 400 : { error: string }  — validation failure
 * Response 401 : { error: string }  — missing or invalid JWT
 * Response 500 : { error: string }  — Supabase write failure
 *
 * Phase: Phase 1 — Supabase schema + minimal onboarding (06-implementation.md §4, 05-backend-schema.md)
 */

import { createClient } from '@supabase/supabase-js';
import { encryptToken } from '../lib/crypto/tokenCipher.js';
import { createSupabaseAdmin } from '../lib/supabase/admin.js';

// Fields that must be present and non-empty in the request body
const REQUIRED_FIELDS = [
  'first_name', 'last_name', 'student_email', 'phone',
  'school_name', 'major', 'degree_pursuing',
  'grad_month', /* grad_year checked separately as a number */
];

const VALID_JOB_TYPES = new Set(['full_time', 'part_time', 'internship', 'not_sure']);
const MAX_RESUME_BYTES = 1_048_576; // 1 MiB (1,048,576 bytes) — enforced at API layer per 05-backend-schema.md

/**
 * Generates a signed URL for a profile's latest uploaded resume.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} profileId
 * @param {number} expiresInSeconds - Default 3600 (1 hour)
 * @returns {Promise<string|null>}
 */
export async function getResumeUrl(supabase, profileId, expiresInSeconds = 3600) {
  const { data: resume, error } = await supabase
    .from('resumes')
    .select('storage_path')
    .eq('profile_id', profileId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !resume?.storage_path) {
    return null;
  }

  const { data: signedData, error: signError } = await supabase
    .storage
    .from('resumes')
    .createSignedUrl(resume.storage_path, expiresInSeconds);

  if (signError || !signedData?.signedUrl) {
    return null;
  }

  return signedData.signedUrl;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify JWT ──────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    console.warn('[onboarding 401] Missing or invalid Bearer token');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[onboarding 500] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // anon key + user JWT → RLS scopes all DB operations to auth.uid()
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    console.warn('[onboarding 401] User authentication verification failed:', authError?.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  const body = req.body ?? {};

  // ── 3. Required-field validation ───────────────────────────────────────────
  for (const field of REQUIRED_FIELDS) {
    const val = body[field];
    if (val === undefined || val === null || String(val).trim() === '') {
      console.warn(`[onboarding 400] Missing required field: ${field}`);
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  if (body.has_existing_handshake_account === undefined || body.has_existing_handshake_account === null) {
    console.warn('[onboarding 400] Missing required field: has_existing_handshake_account');
    return res.status(400).json({ error: 'Missing required field: has_existing_handshake_account' });
  }

  const hasAccount = Boolean(body.has_existing_handshake_account);
  if (hasAccount) {
    if (!body.handshake_email || typeof body.handshake_email !== 'string' || !body.handshake_email.trim()) {
      console.warn('[onboarding 400] Missing required field: handshake_email when has_existing_handshake_account is true');
      return res.status(400).json({ error: 'Missing required field: handshake_email when has_existing_handshake_account is true' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.handshake_email.trim())) {
      console.warn('[onboarding 400] handshake_email must be a valid email address');
      return res.status(400).json({ error: 'handshake_email must be a valid email address' });
    }
    if (!body.handshake_password || typeof body.handshake_password !== 'string' || !body.handshake_password.trim()) {
      console.warn('[onboarding 400] Missing required field: handshake_password when has_existing_handshake_account is true');
      return res.status(400).json({ error: 'Missing required field: handshake_password when has_existing_handshake_account is true' });
    }
  }

  const gradYear = Number(body.grad_year);
  if (!body.grad_year || isNaN(gradYear) || !Number.isInteger(gradYear)) {
    console.warn('[onboarding 400] Missing or invalid grad_year (must be an integer)');
    return res.status(400).json({ error: 'Missing required field: grad_year (must be an integer)' });
  }

  // ── 4. Domain-specific validation ─────────────────────────────────────────
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.student_email.trim())) {
    console.warn('[onboarding 400] student_email must be a valid email address');
    return res.status(400).json({ error: 'student_email must be a valid email address' });
  }

  const jobTypes = Array.isArray(body.job_types) ? body.job_types : [];
  for (const jt of jobTypes) {
    if (!VALID_JOB_TYPES.has(jt)) {
      console.warn(`[onboarding 400] Invalid job_type value: "${jt}"`);
      return res.status(400).json({ error: `Invalid job_type value: "${jt}". Must be one of: full_time, part_time, internship, not_sure` });
    }
  }

  // ── 5. Resume Handling (<1MB PDF check & Storage upload) ───────────────────
  let storagePath = body.resume_storage_path;
  let resumeBytes = Number(body.resume_file_size_bytes);

  if (body.resume_base64) {
    let buffer;
    try {
      buffer = Buffer.from(body.resume_base64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid resume_base64 encoding' });
    }

    resumeBytes = buffer.length;
    if (resumeBytes > MAX_RESUME_BYTES) {
      return res.status(400).json({ error: 'Resume must be under 1 MB (1,048,576 bytes)' });
    }

    // Verify PDF header magic bytes (%PDF)
    const isPdfHeader = buffer.slice(0, 4).toString() === '%PDF';
    if (!isPdfHeader) {
      return res.status(400).json({ error: 'Resume must be a valid PDF file' });
    }

    storagePath = `${user.id}/${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('[onboarding] resume storage upload error:', uploadError.message);
      return res.status(500).json({ error: `Resume upload failed: ${uploadError.message}` });
    }
  } else {
    if (!storagePath || isNaN(resumeBytes)) {
      console.warn('[onboarding 400] Missing resume: provide resume_base64 or resume_storage_path + resume_file_size_bytes');
      return res.status(400).json({ error: 'Missing resume: provide resume_base64 or resume_storage_path + resume_file_size_bytes' });
    }
    if (resumeBytes > MAX_RESUME_BYTES) {
      console.warn('[onboarding 400] Resume must be under 1 MB');
      return res.status(400).json({ error: 'Resume must be under 1 MB (1,048,576 bytes)' });
    }
  }

  // ── 6. Encrypt handshake_password if provided ──────────────────────────────
  let handshakePasswordEnc = null;
  if (hasAccount && body.handshake_password) {
    try {
      handshakePasswordEnc = encryptToken(body.handshake_password.trim());
    } catch (encErr) {
      console.error('[onboarding] handshake_password encryption error:', encErr.message);
      return res.status(500).json({ error: 'Failed to secure Handshake credentials.' });
    }
  }

  // ── 7. Upsert profiles row (client-role RLS scoped) ────────────────────────
  const profilePayload = {
    id:                               user.id,
    first_name:                       body.first_name.trim(),
    last_name:                        body.last_name.trim(),
    student_email:                    body.student_email.trim().toLowerCase(),
    phone:                            body.phone.trim(),
    school_name:                      body.school_name.trim(),
    major:                            body.major.trim(),
    degree_pursuing:                  body.degree_pursuing,
    grad_month:                       body.grad_month,
    grad_year:                        gradYear,
    school_additional_info:           body.school_additional_info?.trim() || null,
    job_types:                        jobTypes,
    locations_open_to:                Array.isArray(body.locations_open_to) ? body.locations_open_to : [],
    job_interests:                    Array.isArray(body.job_interests)     ? body.job_interests     : [],
    profile_visibility:               body.profile_visibility || 'community',
    job_alerts_opt_in:                body.job_alerts_opt_in !== false,
    has_existing_handshake_account:   hasAccount,
    handshake_email:                  hasAccount ? body.handshake_email.trim().toLowerCase() : null,
  };

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' });

  if (profileError) {
    console.error('[onboarding] profiles upsert error:', profileError.message);
    return res.status(500).json({ error: profileError.message });
  }

  // ── 8. Update handshake_password_enc via service role (column is service-role only) ─
  let adminSupabase;
  try {
    adminSupabase = createSupabaseAdmin();
  } catch (adminInitErr) {
    console.error('[onboarding] createSupabaseAdmin init error:', adminInitErr.message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { error: passwordEncError } = await adminSupabase
    .from('profiles')
    .update({ handshake_password_enc: hasAccount ? handshakePasswordEnc : null })
    .eq('id', user.id);

  if (passwordEncError) {
    console.error('[onboarding] handshake_password_enc update error:', passwordEncError.message);
    return res.status(500).json({ error: 'Failed to store Handshake security credentials.' });
  }

  // ── 9. Insert resumes row ──────────────────────────────────────────────────
  const { error: resumeError } = await supabase
    .from('resumes')
    .insert({
      profile_id:      user.id,
      storage_path:    storagePath,
      file_size_bytes: resumeBytes,
    });

  if (resumeError) {
    console.error('[onboarding] resumes insert error:', resumeError.message);
    return res.status(500).json({ error: resumeError.message });
  }

  // ── 10. Resolve getResumeUrl(profileId) ─────────────────────────────────────
  const resumeUrl = await getResumeUrl(supabase, user.id);

  return res.status(200).json({
    profile_id: user.id,
    resume_url: resumeUrl,
  });
}

