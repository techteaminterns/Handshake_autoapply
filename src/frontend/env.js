import Constants from 'expo-constants';

const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};

const getEnv = (key, fallbackKey) => {
  if (extra[key]) return extra[key];
  if (fallbackKey && extra[fallbackKey]) return extra[fallbackKey];
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || (fallbackKey ? process.env[fallbackKey] : undefined);
  }
  return undefined;
};

export const API_URL = getEnv('API_URL', 'EXPO_PUBLIC_API_URL') || getEnv('VERCEL_URL', 'EXPO_PUBLIC_VERCEL_URL');

export const SUPABASE_URL = getEnv('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = getEnv('SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
export const SUPABASE_PUBLISHABLE_KEY = getEnv('SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
export const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
export const SUPABASE_ACCESS_TOKEN = getEnv('SUPABASE_ACCESS_TOKEN');

export const TELEGRAM_BOT_TOKEN = getEnv('TELEGRAM_BOT_TOKEN');
export const TELEGRAM_BOT_USERNAME = getEnv('TELEGRAM_BOT_USERNAME') || 'simpleclickonetimeusetestbot';

export const GOOGLE_OAUTH_CLIENT_ID = getEnv('GOOGLE_OAUTH_CLIENT_ID');
export const GOOGLE_OAUTH_CLIENT_SECRET = getEnv('GOOGLE_OAUTH_CLIENT_SECRET');

export const ENCRYPTION_KEY = getEnv('ENCRYPTION_KEY');
