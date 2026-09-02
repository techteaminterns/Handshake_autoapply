/**
 * Supabase client for the React Native app.
 *
 * Uses the publishable key (anon key) with AsyncStorage for session persistence.
 * RLS policies enforce all data-access boundaries server-side.
 */

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

if (!SUPABASE_URL) {
  throw new Error('[supabase.js] SUPABASE_URL is missing. Please ensure SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL is configured in your environment.');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('[supabase.js] SUPABASE_ANON_KEY is missing. Please ensure SUPABASE_ANON_KEY, SUPABASE_PUBLISHABLE_KEY, or EXPO_PUBLIC_SUPABASE_ANON_KEY is configured in your environment.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
