import { readEnv } from './env.js';

const PLACEHOLDER_PATTERNS = ['YOUR_PROJECT_REF', 'your-anon-key', 'your-service-role-key'];

export function getClientAuthConfig() {
  const url = readEnv('SUPABASE_URL');
  const anonKey = readEnv('SUPABASE_ANON_KEY') || readEnv('SUPABASE_PUBLISHABLE_KEY') || readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const valid = Boolean(
    url && anonKey && url.includes('supabase.co') &&
    !PLACEHOLDER_PATTERNS.some((p) => url.includes(p) || anonKey.includes(p))
  );
  return { enabled: valid, url: valid ? url : null, anonKey: valid ? anonKey : null };
}
