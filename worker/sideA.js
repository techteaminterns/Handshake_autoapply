/**
 * worker/sideA.js
 *
 * Side A interface functions called by Side B (Playwright bot) and the local
 * worker loop. All functions use the service-role Supabase client — they run
 * in a server-side Node.js process, never in a browser or with a user JWT.
 *
 * Phase: V1-A5 (07-workflow-side-a.md, 05-backend-schema.md, 06-implementation.md)
 *
 * Interface contract (07-workflow-side-a.md L10–20):
 *   getProfile               — returns normalized profile for filling Handshake forms
 *   getResumeUrl             — Supabase Storage signed URL for resume
 *   claimNextJob             — atomically claims next QUEUED application (RPC)
 *   markJobStatus            — updates applications.status + writes audit event
 *   createIntervention       — creates OPEN intervention row; returns interventionId
 *   resolveIntervention      — polls until RESOLVED; returns answer string
 *   storeJobsFromScrape      — upserts handshake_jobs; returns new job count
 *   checkAndIncrementActionCount — 300/day rate limit guard (atomic RPC)
 *
 * AGENTS.md rules honoured:
 *   - No setTimeout inside Playwright steps. The setTimeout in resolveIntervention
 *     is inside a pure Node.js worker poll loop, NOT a Playwright step.
 *   - handshake_password_enc is never returned (excluded from getProfile SELECT).
 *   - claimNextJob uses the atomic claim_next_job RPC (FOR UPDATE SKIP LOCKED).
 *   - checkAndIncrementActionCount uses the atomic check_and_increment_action_count RPC.
 */

import { createSupabaseAdmin } from '../lib/supabase/admin.js';

// ---------------------------------------------------------------------------
// 1. getProfile
// ---------------------------------------------------------------------------

/**
 * Returns the normalized profile object for a given user.
 * Used by Side B to fill Handshake forms.
 *
 * @param {string} profileId — Supabase user UUID
 * @returns {Promise<{
 *   id: string,
 *   first_name: string,
 *   last_name: string,
 *   student_email: string,
 *   phone: string,
 *   school_name: string,
 *   major: string,
 *   degree_pursuing: string,
 *   grad_month: string,
 *   grad_year: string,
 *   school_additional_info: string|null,
 *   job_types: string[],
 *   locations_open_to: string[],
 *   job_interests: string,
 *   profile_visibility: string,
 *   job_alerts_opt_in: boolean,
 *   has_existing_handshake_account: boolean,
 *   handshake_email: string|null,
 *   telegram_chat_id: string|null,
 * }>}
 * @throws {Error} 'profile_not_found: <profileId>'        — no row for this ID
 * @throws {Error} '[getProfile] <supabase error message>'  — DB error
 */
export async function getProfile(profileId) {
  const admin = createSupabaseAdmin();

  const { data, error } = await admin
    .from('profiles')
    .select(`
      id,
      first_name,
      last_name,
      student_email,
      phone,
      school_name,
      major,
      degree_pursuing,
      grad_month,
      grad_year,
      school_additional_info,
      job_types,
      locations_open_to,
      job_interests,
      profile_visibility,
      job_alerts_opt_in,
      has_existing_handshake_account,
      handshake_email,
      telegram_chat_id
    `)
    .eq('id', profileId)
    .maybeSingle();

  if (error) throw new Error(`[getProfile] ${error.message}`);
  if (!data) throw new Error(`profile_not_found: ${profileId}`);

  return data;
}

// ---------------------------------------------------------------------------
// 2. getResumeUrl
// ---------------------------------------------------------------------------

/**
 * Returns a signed Supabase Storage URL for the user's most recently uploaded
 * resume PDF. The URL is valid for 1 hour (3600 seconds).
 *
 * @param {string} profileId — Supabase user UUID
 * @returns {Promise<string>} HTTPS signed URL (expires in 1 hour)
 * @throws {Error} 'resume_not_found: <profileId>'          — no resume row found
 * @throws {Error} '[getResumeUrl] storage: <message>'      — Storage signing error
 * @throws {Error} '[getResumeUrl] <supabase error message>' — DB error
 */
export async function getResumeUrl(profileId) {
  const admin = createSupabaseAdmin();

  // Step 1: look up the storage_path from the resumes table
  const { data: row, error: dbErr } = await admin
    .from('resumes')
    .select('storage_path')
    .eq('profile_id', profileId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dbErr) throw new Error(`[getResumeUrl] ${dbErr.message}`);
  if (!row) throw new Error(`resume_not_found: ${profileId}`);

  // Step 2: generate signed URL via Storage
  const { data: signed, error: storageErr } = await admin.storage
    .from('resumes')
    .createSignedUrl(row.storage_path, 3600);

  if (storageErr) throw new Error(`[getResumeUrl] storage: ${storageErr.message}`);
  if (!signed?.signedUrl) throw new Error(`[getResumeUrl] storage: empty signedUrl for ${row.storage_path}`);

  return signed.signedUrl;
}

// ---------------------------------------------------------------------------
// 3. claimNextJob
// ---------------------------------------------------------------------------

/**
 * Atomically claims the next QUEUED application for a given profile.
 * Uses the claim_next_job Postgres RPC (FOR UPDATE SKIP LOCKED) — never a
 * separate SELECT + UPDATE, per AGENTS.md rule.
 *
 * @param {string} profileId — Supabase user UUID
 * @param {string} workerId  — worker identifier string (e.g. 'worker-1')
 * @returns {Promise<object|null>}
 *   Full applications row with status=PROCESSING, or null if queue is empty.
 *   Shape: { id, profile_id, job_id, status, current_step, worker_id,
 *            lock_acquired_at, started_at, queued_at, priority, ... }
 * @throws {Error} '[claimNextJob] <supabase error message>' — DB/RPC error
 */
export async function claimNextJob(profileId, workerId) {
  const admin = createSupabaseAdmin();

  const { data, error } = await admin.rpc('claim_next_job', {
    p_profile_id: profileId,
    p_worker_id: workerId,
  });

  if (error) throw new Error(`[claimNextJob] ${error.message}`);

  // RPC returns null or a composite record with null id when no QUEUED row is available
  if (!data || !data.id) return null;

  return data;
}

// ---------------------------------------------------------------------------
// 4. markJobStatus
// ---------------------------------------------------------------------------

/**
 * Updates applications.status and writes an application_events audit row.
 * Invalid transitions are rejected by the DB trigger.
 *
 * @param {string} applicationId            — UUID of the applications row
 * @param {'PROCESSING'|'NEEDS_INPUT'|'SUBMITTING'|'SUBMITTED'|'FAILED'|'REJECTED'} status
 * @param {string} [stepOrReason]           — current_step (when not FAILED) or
 *                                            error_message (when FAILED/REJECTED)
 * @returns {Promise<{ ok: true }>}
 * @throws {Error} '[markJobStatus transition] ...' — DB trigger rejected the transition
 * @throws {Error} '[markJobStatus] ...'            — DB error
 */
export async function markJobStatus(applicationId, status, stepOrReason) {
  const admin = createSupabaseAdmin();
  const now = new Date().toISOString();

  const updatePayload = {
    status,
    updated_at: now,
  };

  if (stepOrReason) {
    if (status === 'FAILED' || status === 'REJECTED') {
      updatePayload.error_message = stepOrReason;
    } else {
      updatePayload.current_step = stepOrReason;
    }
  }

  if (status === 'SUBMITTED') {
    updatePayload.submitted_at = now;
    updatePayload.finished_at = now;
  } else if (status === 'FAILED' || status === 'REJECTED') {
    updatePayload.finished_at = now;
  }

  const { error: updateErr } = await admin
    .from('applications')
    .update(updatePayload)
    .eq('id', applicationId);

  if (updateErr) {
    const prefix = updateErr.message?.includes('illegal status transition')
      ? '[markJobStatus transition]'
      : '[markJobStatus]';
    throw new Error(`${prefix} ${updateErr.message}`);
  }

  // Write audit event
  const { error: eventErr } = await admin
    .from('application_events')
    .insert({
      application_id: applicationId,
      event_type: status.toLowerCase(),
      step: updatePayload.current_step ?? null,
      message: stepOrReason ?? null,
    });

  if (eventErr) throw new Error(`[markJobStatus audit] ${eventErr.message}`);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 5. createIntervention
// ---------------------------------------------------------------------------

const VALID_INTERVENTION_TYPES = ['OTP', 'EMAIL_CONFIRM', 'UNKNOWN_QUESTION', 'AUTH'];

/**
 * Creates an OPEN intervention row in the interventions table.
 * Supabase Realtime fires on the INSERT so the monitoring UI popup appears
 * immediately without polling.
 *
 * @param {string}      profileId      — Supabase user UUID
 * @param {'OTP'|'EMAIL_CONFIRM'|'UNKNOWN_QUESTION'|'AUTH'} type
 * @param {string}      [applicationId] — FK to applications row (null for session-level interventions)
 * @param {string}      [questionText]  — Human-readable prompt for UNKNOWN_QUESTION / OTP
 * @param {Array}       [options]       — Array of choices for UNKNOWN_QUESTION (null for free-text)
 * @returns {Promise<string>} interventionId (UUID)
 * @throws {Error} 'invalid intervention type: <type>'      — bad type value
 * @throws {Error} '[createIntervention] <supabase error>'  — DB error
 */
export async function createIntervention(
  profileId,
  type,
  applicationId,
  questionText,
  options,
) {
  if (!VALID_INTERVENTION_TYPES.includes(type)) {
    throw new Error(`invalid intervention type: ${type}`);
  }

  const admin = createSupabaseAdmin();

  const { data, error } = await admin
    .from('interventions')
    .insert({
      profile_id: profileId,
      application_id: applicationId ?? null,
      type,
      question_text: questionText ?? null,
      options: options ?? null,
      status: 'OPEN',
    })
    .select('id')
    .single();

  if (error) throw new Error(`[createIntervention] ${error.message}`);

  return data.id;
}

// ---------------------------------------------------------------------------
// 6. resolveIntervention
// ---------------------------------------------------------------------------

const DEFAULT_RESOLVE_TIMEOUT_MS = 300_000; // 5 minutes
const RESOLVE_POLL_INTERVAL_MS = 2_000;     // 2 seconds per 06-implementation.md L58

/**
 * Polls the interventions table every 2 seconds until status = 'RESOLVED' or
 * the timeout expires. Returns the user's answer string.
 *
 * NOTE: setTimeout is used here intentionally. This function runs in the local
 * Node.js worker process (worker/sideA.js), NOT inside a Playwright step.
 * AGENTS.md forbids setTimeout only inside Playwright steps — this is a pure
 * Node.js poll loop.
 *
 * @param {string} interventionId   — UUID of the interventions row
 * @param {number} [timeoutMs=300000] — How long to wait before giving up (ms)
 * @returns {Promise<string>} The answer the user submitted
 * @throws {Error} 'intervention_cancelled: <id>'  — user or system cancelled it
 * @throws {Error} 'intervention_timeout: <id>'    — timed out waiting for user
 * @throws {Error} '[resolveIntervention] ...'      — DB error mid-poll
 */
export async function resolveIntervention(interventionId, timeoutMs = DEFAULT_RESOLVE_TIMEOUT_MS) {
  const admin = createSupabaseAdmin();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('interventions')
      .select('status, answer')
      .eq('id', interventionId)
      .single();

    if (error) throw new Error(`[resolveIntervention] ${error.message}`);

    if (data.status === 'RESOLVED') return data.answer;
    if (data.status === 'CANCELLED') throw new Error(`intervention_cancelled: ${interventionId}`);

    // Wait before next poll — intentional setTimeout in Node.js worker context
    await new Promise((resolve) => setTimeout(resolve, RESOLVE_POLL_INTERVAL_MS));
  }

  throw new Error(`intervention_timeout: ${interventionId}`);
}

// ---------------------------------------------------------------------------
// 7. storeJobsFromScrape
// ---------------------------------------------------------------------------

/**
 * Upserts scraped job objects into handshake_jobs, deduplicated by URL.
 * Returns the count of newly inserted (previously unknown) jobs.
 *
 * @param {string} profileId — Supabase user UUID
 * @param {Array<{
 *   url: string,
 *   title: string,
 *   company?: string|null,
 *   location?: string|null,
 *   has_quick_apply: boolean,
 *   raw_metadata?: object|null,
 * }>} jobs — array of normalized job objects from the scraper
 * @returns {Promise<number>} count of newly inserted jobs (0 if all were duplicates)
 * @throws {Error} 'invalid job entry: ...'           — missing url or title in a job
 * @throws {Error} '[storeJobsFromScrape] ...'        — DB error
 */
export async function storeJobsFromScrape(profileId, jobs) {
  if (!jobs || jobs.length === 0) return 0;

  // Validate every entry before touching the DB
  for (const j of jobs) {
    if (!j.url || !j.title) {
      throw new Error(`invalid job entry: missing url or title — ${JSON.stringify(j)}`);
    }
  }

  const admin = createSupabaseAdmin();
  const urls = jobs.map((j) => j.url);

  // Step 1: find which URLs already exist for this profile
  const { data: existing, error: lookupErr } = await admin
    .from('handshake_jobs')
    .select('url')
    .eq('profile_id', profileId)
    .in('url', urls);

  if (lookupErr) throw new Error(`[storeJobsFromScrape] lookup: ${lookupErr.message}`);

  const existingUrls = new Set((existing ?? []).map((r) => r.url));
  const newCount = jobs.filter((j) => !existingUrls.has(j.url)).length;

  // Step 2: upsert all rows (updates raw_metadata / discovered_at on re-scrape)
  const rows = jobs.map((j) => ({
    profile_id: profileId,
    url: j.url,
    title: j.title,
    company: j.company ?? null,
    location: j.location ?? null,
    has_quick_apply: Boolean(j.has_quick_apply),
    raw_metadata: j.raw_metadata ?? null,
    discovered_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await admin
    .from('handshake_jobs')
    .upsert(rows, { onConflict: 'profile_id,url' });

  if (upsertErr) throw new Error(`[storeJobsFromScrape] upsert: ${upsertErr.message}`);

  return newCount;
}

// ---------------------------------------------------------------------------
// 8. checkAndIncrementActionCount
// ---------------------------------------------------------------------------

/**
 * Enforces the 300-actions-per-day rate limit per profileId (UTC day).
 * Uses the atomic check_and_increment_action_count Postgres RPC:
 * — if count < 300: increments count and returns true (action allowed)
 * — if count >= 300: no change and returns false (action blocked)
 *
 * Per AGENTS.md: "Enforce the 300-actions/day rate limit via
 * checkAndIncrementActionCount before each Handshake action."
 *
 * @param {string} profileId — Supabase user UUID
 * @returns {Promise<boolean>}
 *   true  — action is allowed; count has been incremented
 *   false — daily cap reached; caller must halt worker
 * @throws {Error} '[checkAndIncrementActionCount] ...' — DB/RPC error
 */
export async function checkAndIncrementActionCount(profileId) {
  const admin = createSupabaseAdmin();

  const { data, error } = await admin.rpc('check_and_increment_action_count', {
    p_profile_id: profileId,
  });

  if (error) throw new Error(`[checkAndIncrementActionCount] ${error.message}`);

  // RPC returns boolean true/false
  return Boolean(data);
}
