import { createClient } from '@supabase/supabase-js';
import { readEnv } from './env.js';
import { isValidPhone } from './phone.js';

const AUTH_EMAIL_DOMAIN = 'subarnapasal.app';

export function normalizeUsername(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

export function isSyntheticAuthEmail(email: string): boolean {
  return String(email || '').trim().toLowerCase().endsWith(`@${AUTH_EMAIL_DOMAIN}`);
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function isValidPassword(password: string): boolean {
  const value = String(password || '');
  return value.length >= 6 && value.length <= 128;
}

function getAnonKey(): string {
  return (
    readEnv('SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_PUBLISHABLE_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}

function getAuthUrl(): string {
  return readEnv('SUPABASE_URL');
}

function isUserJwtAuthorization(value: string): boolean {
  return /^Bearer\s+eyJ/i.test(String(value || '').trim());
}

function createOpaqueKeyFetch(key: string) {
  return (input: any, init: any = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('apikey', key);
    if (!isUserJwtAuthorization(headers.get('Authorization') || '')) {
      headers.delete('Authorization');
    }
    return fetch(input, { ...init, headers });
  };
}

function createAnonClientOptions(anonKey: string) {
  const options: any = { auth: { persistSession: false, autoRefreshToken: false } };
  if (anonKey.startsWith('sb_publishable_')) {
    options.global = { headers: { apikey: anonKey }, fetch: createOpaqueKeyFetch(anonKey) };
  }
  return options;
}

export function isAuthConfigured(): boolean {
  const url = getAuthUrl();
  const anonKey = getAnonKey();
  const placeholders = ['YOUR_PROJECT_REF', 'your-anon-key', 'your-service-role-key'];
  return Boolean(
    url && anonKey && url.includes('supabase.co') &&
    !placeholders.some((p) => url.includes(p) || anonKey.includes(p))
  );
}

export function getAnonAuthClient() {
  const url = getAuthUrl();
  const anonKey = getAnonKey();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, createAnonClientOptions(anonKey));
}

export async function findUserByUsername(adminClient: any, username: string) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  let page = 1;
  const perPage = 200;
  while (page <= 10) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((user: any) => {
      const metaUsername = normalizeUsername(user.user_metadata?.username);
      return metaUsername === normalized || user.email === usernameToEmail(normalized);
    });
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

export async function resolveAuthEmail(adminClient: any, username: string): Promise<string> {
  const normalized = normalizeUsername(username);
  const canonical = usernameToEmail(normalized);
  const existing = await findUserByUsername(adminClient, normalized);
  return existing?.email || canonical;
}

export async function getUserFromToken(token: string) {
  if (!token) return null;
  const authUrl = getAuthUrl();
  const anonKey = getAnonKey();
  if (!authUrl || !anonKey) return null;
  try {
    const res = await fetch(`${authUrl.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

export async function getUserIdFromToken(token: string): Promise<string | null> {
  const user = await getUserFromToken(token);
  return (user as any)?.id || null;
}

export async function updateAuthenticatedUserPassword(accessToken: string, password: string) {
  const authUrl = getAuthUrl();
  const anonKey = getAnonKey();
  if (!authUrl || !anonKey || !accessToken) return { error: 'Sign-in is not configured yet.' };
  try {
    const res = await fetch(`${authUrl.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) return { error: null };
    const err: any = await res.json().catch(() => ({}));
    return { error: err.msg || err.error_description || err.message || 'Could not update password.' };
  } catch (err: any) {
    return { error: err.message || 'Could not update password.' };
  }
}

function formatNameFromEmail(email: string): string {
  const local = String(email || '').split('@')[0] || '';
  if (!local) return '';
  return local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim()
    .split(/\s+/).filter(Boolean)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function displayNameFromUser(user: any): string {
  const meta = user?.user_metadata || {};
  return String(meta.full_name || meta.name || '').trim();
}

export async function lookupDisplayNameFromDb(adminClient: any, user: any): Promise<string> {
  const stored = displayNameFromUser(user);
  if (stored) return stored;
  const meta = user?.user_metadata || {};
  const emails = [
    String(meta.contact_email || '').trim().toLowerCase(),
    isSyntheticAuthEmail(user?.email) ? '' : String(user?.email || '').trim().toLowerCase()
  ].filter(Boolean);
  for (const email of [...new Set(emails)]) {
    const { data, error } = await adminClient.from('users').select('name').ilike('email', email).maybeSingle();
    if (!error && data?.name) return String(data.name).trim();
  }
  const contactEmail = String(meta.contact_email || '').trim();
  if (contactEmail) return formatNameFromEmail(contactEmail);
  if (!isSyntheticAuthEmail(user?.email)) return formatNameFromEmail(user.email);
  return '';
}

export { isValidPhone };
