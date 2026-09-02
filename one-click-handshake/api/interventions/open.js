/**
 * GET /api/interventions/open
 *
 * Retrieves the current topmost OPEN intervention for the authenticated user.
 *
 * Auth: Supabase session JWT (Bearer token in Authorization header)
 * DB: Uses anon key + user JWT so RLS scopes queries to profile_id = auth.uid()
 *
 * Response 200: { intervention: InterventionObject | null }
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
    console.error('[interventions/open] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Query topmost OPEN intervention ─────────────────────────────────────
  const { data: intervention, error: queryError } = await supabase
    .from('interventions')
    .select('id, application_id, profile_id, type, question_text, options, status, created_at')
    .eq('profile_id', user.id)
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (queryError) {
    console.error('[interventions/open] query error:', queryError.message);
    return res.status(500).json({ error: queryError.message });
  }

  return res.status(200).json({ intervention: intervention || null });
}
