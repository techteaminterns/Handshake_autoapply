import dotenv from 'dotenv';
import path from 'path';


const envFile = `.env.${process.env.NODE_ENV || 'development'}.local`;
console.log(`Loading environment variables from ${envFile}`);
dotenv.config({ path: envFile });

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
