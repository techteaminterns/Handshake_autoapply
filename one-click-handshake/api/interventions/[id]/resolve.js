/**
 * POST /api/interventions/:id/resolve
 *
 * Writes the user's answer to the intervention and sets status = 'RESOLVED'.
 *
 * Auth: Supabase session JWT (Bearer token in Authorization header)
 * DB: Verifies ownership with user's JWT, then updates status & answer using service-role.
 *
 * Request Body: { answer: string }
 * Response 200: { ok: true, intervention: Object }
 * Response 400: { error: string }
 * Response 401: { error: string }
 * Response 404: { error: string }
 * Response 500: { error: string }
 */

import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdmin } from '../../../lib/supabase/admin.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[interventions/resolve] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Extract intervention ID & Answer ─────────────────────────────────────
  const interventionId = req.query?.id || req.body?.id || req.body?.intervention_id;
  if (!interventionId) {
    return res.status(400).json({ error: 'Missing intervention id' });
  }

  const body = req.body ?? {};
  if (body.answer === undefined || body.answer === null) {
    return res.status(400).json({ error: 'Missing required field: answer' });
  }
  const answerStr = String(body.answer).trim();

  // ── 3. Verify intervention exists and belongs to this user ─────────────────
  const { data: existing, error: findError } = await supabase
    .from('interventions')
    .select('id, profile_id, status, type')
    .eq('id', interventionId)
    .eq('profile_id', user.id)
    .maybeSingle();

  if (findError) {
    console.error('[interventions/resolve] find error:', findError.message);
    return res.status(500).json({ error: findError.message });
  }

  if (!existing) {
    return res.status(404).json({ error: 'Intervention not found' });
  }

  if (existing.status === 'RESOLVED') {
    return res.status(200).json({ ok: true, status: 'already_resolved', intervention: existing });
  }

  // ── 4. Update via Admin Client ─────────────────────────────────────────────
  let adminSupabase;
  try {
    adminSupabase = createSupabaseAdmin();
  } catch (adminInitErr) {
    console.error('[interventions/resolve] createSupabaseAdmin init error:', adminInitErr.message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { data: updated, error: updateError } = await adminSupabase
    .from('interventions')
    .update({
      status: 'RESOLVED',
      answer: answerStr,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', interventionId)
    .eq('profile_id', user.id)
    .select()
    .single();

  if (updateError) {
    console.error('[interventions/resolve] update error:', updateError.message);
    return res.status(500).json({ error: updateError.message });
  }

  return res.status(200).json({
    ok: true,
    intervention: updated,
  });
}
