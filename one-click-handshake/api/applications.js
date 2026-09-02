/**
 * GET /api/applications
 *
 * Lists applications and their latest status for the monitoring UI.
 * Joins each application with its associated handshake_jobs row.
 *
 * Auth: Supabase session JWT (Bearer token in Authorization header)
 * DB: Uses anon key + user JWT so RLS scopes queries to profile_id = auth.uid()
 *
 * Response 200: { applications: Array<ApplicationItem> }
 * Response 401: { error: string }
 * Response 500: { error: string }
 */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify JWT ──────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[applications] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Query Applications with joined Handshake Jobs ────────────────────────
  const { data: rows, error: queryError } = await supabase
    .from('applications')
    .select(`
      id,
      profile_id,
      job_id,
      status,
      current_step,
      priority,
      attempt_count,
      error_code,
      error_message,
      queued_at,
      started_at,
      submitted_at,
      finished_at,
      updated_at,
      handshake_jobs (
        id,
        title,
        company,
        location,
        url,
        has_quick_apply
      )
    `)
    .eq('profile_id', user.id)
    .order('queued_at', { ascending: false })
    .limit(100);

  if (queryError) {
    console.error('[applications] query error:', queryError.message);
    return res.status(500).json({ error: queryError.message });
  }

  // Normalize shape for client
  const applications = (rows || []).map((app) => ({
    id: app.id,
    profile_id: app.profile_id,
    job_id: app.job_id,
    status: app.status,
    current_step: app.current_step,
    priority: app.priority,
    attempt_count: app.attempt_count,
    error_code: app.error_code,
    error_message: app.error_message,
    queued_at: app.queued_at,
    started_at: app.started_at,
    submitted_at: app.submitted_at,
    finished_at: app.finished_at,
    updated_at: app.updated_at,
    title: app.handshake_jobs?.title || 'Unknown Job',
    company: app.handshake_jobs?.company || null,
    location: app.handshake_jobs?.location || null,
    url: app.handshake_jobs?.url || null,
    has_quick_apply: Boolean(app.handshake_jobs?.has_quick_apply),
  }));

  return res.status(200).json({ applications });
}
