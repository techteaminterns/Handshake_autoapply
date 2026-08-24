/**
 * Supabase service-role client.
 *
 * The service-role client bypasses RLS. Use it ONLY in server-side routes
 * that must write outside the authenticated user's session (e.g. the Gmail
 * OAuth callback, the Telegram webhook). Keep usage scoped to the single
 * profile_id / run_id being operated on — never do open-ended queries.
 *
 * The client role (anon key + user JWT) is still the default for all other
 * routes — see api/onboarding.js for the pattern.
 */

import { createClient } from '@supabase/supabase-js';

/** @returns {import('@supabase/supabase-js').SupabaseClient} */
export function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
    || process.env.EXPO_PUBLIC_SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('[supabase/admin] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // Disable auto-refresh — this client is used in short-lived serverless
      // functions, not a long-lived browser session.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
