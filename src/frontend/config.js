/**
 * App-level configuration for the OneClickHandshake React Native app.
 *
 * API_URL: points to the Vercel backend.
 *   - Auto-resolves from ENV (API_URL or EXPO_PUBLIC_API_URL / VERCEL_URL)
 *   - Auto-resolves from window.location.origin if deployed on Vercel
 *   - Falls back to http://localhost:3000 for local dev
 */

import {
  API_URL as ENV_API_URL,
  SUPABASE_URL as ENV_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY as ENV_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_ANON_KEY as ENV_SUPABASE_ANON_KEY,
  TELEGRAM_BOT_USERNAME as ENV_TELEGRAM_BOT_USERNAME,
} from './env.js';

const getApiUrl = () => {
  if (ENV_API_URL && ENV_API_URL.trim()) {
    const trimmed = ENV_API_URL.trim();
    return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
  }
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    !window.location.origin.includes(':8081') &&
    !window.location.origin.includes(':19006')
  ) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
};

export const API_URL = getApiUrl();
export const SUPABASE_URL = ENV_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = ENV_SUPABASE_PUBLISHABLE_KEY || ENV_SUPABASE_ANON_KEY || '';
export const TELEGRAM_BOT_USERNAME = ENV_TELEGRAM_BOT_USERNAME || 'simpleclickonetimeusetestbot';

console.log('[config] API_URL:', API_URL);
console.log('[config] SUPABASE_URL:', SUPABASE_URL);
console.log('[config] SUPABASE_ANON_KEY set:', Boolean(SUPABASE_ANON_KEY));
