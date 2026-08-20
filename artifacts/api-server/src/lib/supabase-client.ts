import { createClient } from '@supabase/supabase-js';
import { readEnv } from './env.js';
import {
  CORE_TABLES, supabaseErrorMessage, isMissingTableError,
  isMissingUserIdColumnError, missingTablesMessage, missingUserIdMessage
} from './db-schema.js';

const url = readEnv('SUPABASE_URL');
const key = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SECRET_KEY');

const PLACEHOLDER_PATTERNS = ['YOUR_PROJECT_REF', 'your-service-role-key', 'your-anon-key'];

function isOpaqueSecretKey(value: string): boolean {
  return value.startsWith('sb_secret_');
}

function hasValidCredentials(): boolean {
  if (!url || !key) return false;
  if (key.startsWith('sb_publishable_')) return false;
  return !PLACEHOLDER_PATTERNS.some((p) => url.includes(p) || key.includes(p));
}

export function isSupabaseEnabled(): boolean {
  return hasValidCredentials();
}

export function supabaseConfigStatus() {
  const hasUrl = Boolean(url && url.includes('supabase.co'));
  const hasKey = Boolean(key);
  const valid = hasValidCredentials();
  let reason: string | null = null;
  if (!hasUrl) reason = 'SUPABASE_URL is missing or invalid';
  else if (!hasKey) reason = 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is missing';
  else if (key.startsWith('sb_publishable_')) reason = 'Use the secret/service key on the server, not the publishable key';
  else if (!valid) reason = 'Supabase env vars still contain placeholder values';
  return { hasUrl, hasKey, valid, reason };
}

function createServiceClientOptions() {
  const options: any = { auth: { persistSession: false, autoRefreshToken: false } };
  if (isOpaqueSecretKey(key)) {
    options.global = {
      headers: { apikey: key },
      fetch: (input: any, init: any = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set('apikey', key);
        const auth = headers.get('Authorization') || '';
        if (!/^Bearer\s+eyJ/i.test(auth)) headers.delete('Authorization');
        return fetch(input, { ...init, headers });
      }
    };
  }
  return options;
}

let client: any = null;

export function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) client = createClient(url, key, createServiceClientOptions());
  return client;
}

async function checkTable(supabase: any, table: string) {
  const { error, count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    return { table, ok: false, count: null, error: supabaseErrorMessage(error) || 'Query failed', missing: isMissingTableError(error), needsMigration: false };
  }
  const { error: userIdError } = await supabase.from(table).select('user_id').limit(1);
  if (userIdError && isMissingUserIdColumnError(userIdError)) {
    return { table, ok: false, count: count ?? 0, error: 'column user_id does not exist', missing: false, needsMigration: true };
  }
  return { table, ok: true, count: count ?? 0, error: null, needsMigration: false };
}

export async function checkSupabaseConnection() {
  const status = supabaseConfigStatus();
  if (!status.valid) {
    return { ok: false, ...status, error: status.reason, tables: {}, missingTables: [] };
  }
  try {
    const supabase = getSupabase();
    const results = await Promise.all(CORE_TABLES.map((table) => checkTable(supabase, table)));
    const tables = Object.fromEntries(results.map((row) => [row.table, row]));
    const missingTables = results.filter((row) => row.missing).map((row) => row.table);
    const migrationTables = results.filter((row) => row.needsMigration).map((row) => row.table);
    const failedTables = results.filter((row) => !row.ok);
    if (migrationTables.length) {
      return { ok: false, ...status, tables, missingTables: [], migrationTables, error: missingUserIdMessage(), setup: 'Supabase Dashboard → SQL → paste supabase/per-user-data.sql → Run' };
    }
    if (missingTables.length) {
      return { ok: false, ...status, tables, missingTables, error: missingTablesMessage(missingTables), setup: 'Supabase Dashboard → SQL → New query → paste supabase/schema.sql → Run' };
    }
    if (failedTables.length) {
      const detail = failedTables.map((row) => `${row.table}: ${row.error}`).join('; ');
      return { ok: false, ...status, tables, missingTables: [], error: detail || 'Database query failed' };
    }
    return { ok: true, ...status, tables, missingTables: [], error: null };
  } catch (err: any) {
    return { ok: false, ...status, tables: {}, missingTables: [], error: err.message || 'Connection failed' };
  }
}
