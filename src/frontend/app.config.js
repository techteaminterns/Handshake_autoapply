const path = require('path');
const fs = require('fs');

// Ensure env variables from root or local .env files are loaded in Node context during config evaluation
const envFiles = [
  path.resolve(__dirname, '../../.env.development.local'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '.env.development.local'),
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env'),
];

for (const envFile of envFiles) {
  if (fs.existsSync(envFile)) {
    try {
      const content = fs.readFileSync(envFile, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

module.exports = ({ config }) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || supabaseAnonKey;
  const apiUrl = process.env.API_URL || process.env.EXPO_PUBLIC_API_URL || (process.env.VERCEL_URL ? (process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`) : '') || '';

  return {
    ...config,
    extra: {
      ...config?.extra,
      API_URL: apiUrl,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
      TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME || 'simpleclickonetimeusetestbot',
      GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID || '',
    },
  };
};
