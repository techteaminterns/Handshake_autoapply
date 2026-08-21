import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envFiles = [
  path.resolve(__dirname, '.env.development.local'),
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, 'src/frontend/.env.development.local'),
  path.resolve(__dirname, 'src/frontend/.env.local'),
  path.resolve(__dirname, 'src/frontend/.env'),
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

export default ({ config }) => {
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
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN || '',
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
      TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || 'simpleclickonetimeusetestbot',
      GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
    },
  };
};
