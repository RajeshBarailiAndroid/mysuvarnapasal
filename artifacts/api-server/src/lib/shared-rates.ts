import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseEnabled } from './supabase-client.js';
import { isMissingTableError } from './db-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'shared-gold-rates.json');
const GLOBAL_ID = 'global';
const TOLA_GRAMS = 11.66;
const MAX_HISTORY_PER_MODE = 500;
const MAX_TICKS = 90000;

function daySecondFromUpdatedAt(updatedAt: string): number {
  const dt = new Date(updatedAt);
  if (Number.isNaN(dt.getTime())) return 0;
  return dt.getHours() * 3600 + dt.getMinutes() * 60 + dt.getSeconds();
}

function defaultSharedRates() { return { ticks: [] as any[], history: [] as any[] }; }

function normalizeTick(entry: any) {
  const updatedAt = entry.updatedAt || new Date().toISOString();
  const goldRatePerTola = Number(entry.goldRatePerTola) || 0;
  return {
    date: String(entry.date || updatedAt.slice(0, 10)).slice(0, 10),
    updatedAt,
    daySecond: entry.daySecond != null ? Math.max(0, Math.min(86399, Math.floor(Number(entry.daySecond)))) : daySecondFromUpdatedAt(updatedAt),
    secondNum: Math.max(1, Math.floor(Number(entry.secondNum) || 1)),
    goldRatePerTola,
    goldRatePerGram: Number(entry.goldRatePerGram) || Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    priceMode: entry.priceMode === 'api' ? 'api' : 'manual',
    saved: Boolean(entry.saved)
  };
}

function normalizeHistoryEntry(entry: any) {
  const updatedAt = entry.updatedAt || new Date().toISOString();
  const goldRatePerTola = Number(entry.goldRatePerTola) || 0;
  return {
    date: String(entry.date || updatedAt.slice(0, 10)).slice(0, 10),
    updatedAt,
    goldRatePerTola,
    goldRatePerGram: Number(entry.goldRatePerGram) || Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    priceMode: entry.priceMode === 'api' ? 'api' : 'manual'
  };
}

function trimHistory(history: any[]) {
  const byMode: Record<string, any[]> = { manual: [], api: [] };
  history.forEach((row) => { const mode = row.priceMode === 'api' ? 'api' : 'manual'; byMode[mode].push(row); });
  byMode.manual.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  byMode.api.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...byMode.manual.slice(0, MAX_HISTORY_PER_MODE), ...byMode.api.slice(0, MAX_HISTORY_PER_MODE)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function trimTicks(ticks: any[]) {
  const keepDates = new Set<string>();
  const now = new Date();
  for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(d.getDate() - i); keepDates.add(d.toISOString().slice(0, 10)); }
  const kept = ticks.filter((row) => keepDates.has(row.date) || row.saved).sort((a, b) => a.daySecond - b.daySecond || a.updatedAt.localeCompare(b.updatedAt));
  if (kept.length <= MAX_TICKS) return kept;
  return kept.slice(kept.length - MAX_TICKS);
}

function readJsonSharedRates() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return { ticks: (raw.ticks || []).map(normalizeTick), history: (raw.history || []).map(normalizeHistoryEntry) };
    }
  } catch (_) { /* ignore */ }
  return defaultSharedRates();
}

function writeJsonSharedRates(data: any) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err: any) {
    if (isSupabaseEnabled()) throw err;
    console.warn('shared gold rates: could not write local JSON file:', err.message);
  }
}

async function ensureSharedRatesRow() {
  if (!isSupabaseEnabled()) return;
  const supabase = getSupabase();
  const { data, error } = await supabase.from('shared_gold_rates').select('id').eq('id', GLOBAL_ID).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw new Error('Table shared_gold_rates is missing. Run supabase/shared-gold-rates.sql.');
    throw new Error(`shared gold rates: ${error.message}`);
  }
  if (data) return;
  const { error: insertError } = await supabase.from('shared_gold_rates').insert({ id: GLOBAL_ID, ticks: [], history: [] });
  if (insertError) throw new Error(`shared gold rates init: ${insertError.message}`);
}

/**
 * Prefer the server (Supabase). Mirror to local JSON on success.
 * Fall back to local JSON when the server is unavailable.
 */
export async function readSharedRates() {
  if (isSupabaseEnabled()) {
    try {
      await ensureSharedRatesRow();
      const supabase = getSupabase();
      const { data, error } = await supabase.from('shared_gold_rates').select('ticks, history').eq('id', GLOBAL_ID).maybeSingle();
      if (error) throw new Error(`shared gold rates: ${error.message}`);
      const payload = !data
        ? defaultSharedRates()
        : { ticks: (data.ticks || []).map(normalizeTick), history: (data.history || []).map(normalizeHistoryEntry) };
      writeJsonSharedRates(payload);
      return payload;
    } catch (err: any) {
      console.warn(`shared gold rates: Supabase unavailable (${err.message}), using local JSON.`);
      return readJsonSharedRates();
    }
  }
  return readJsonSharedRates();
}

/**
 * Always write to the server when available, and always save a local copy too.
 * If the server write fails, still save locally.
 */
async function writeSharedRates(data: any) {
  const payload = { ticks: (data.ticks || []).map(normalizeTick), history: trimHistory((data.history || []).map(normalizeHistoryEntry)) };
  payload.ticks = trimTicks(payload.ticks);

  // Local mirror first so a later server failure still leaves a durable copy.
  writeJsonSharedRates(payload);

  if (isSupabaseEnabled()) {
    try {
      await ensureSharedRatesRow();
      const supabase = getSupabase();
      const { error } = await supabase.from('shared_gold_rates').upsert({ id: GLOBAL_ID, ticks: payload.ticks, history: payload.history, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) throw new Error(`shared gold rates write: ${error.message}`);
    } catch (err: any) {
      console.warn(`shared gold rates: Supabase write failed (${err.message}), local JSON already saved.`);
    }
  }
  return payload;
}

export async function appendSharedTicks(ticks: any[]) {
  if (!Array.isArray(ticks) || !ticks.length) return { count: 0 };
  const data = await readSharedRates();
  let count = 0;
  ticks.forEach((tick) => {
    const normalized = normalizeTick(tick);
    const duplicate = data.ticks.findIndex((row: any) => row.date === normalized.date && row.priceMode === normalized.priceMode && row.daySecond === normalized.daySecond);
    if (duplicate >= 0) data.ticks[duplicate] = normalized;
    else data.ticks.push(normalized);
    count += 1;
  });
  await writeSharedRates(data);
  return { count };
}

export async function appendSharedHistory(entry: any) {
  const tola = Number(entry.goldRatePerTola);
  if (!Number.isFinite(tola) || tola <= 0) return { changed: false, history: [] };
  const mode = entry.priceMode === 'api' ? 'api' : 'manual';
  let now = new Date().toISOString();
  const today = String(entry.localDate || entry.date || now.slice(0, 10)).slice(0, 10);
  const gram = Number(entry.goldRatePerGram) || Number((tola / TOLA_GRAMS).toFixed(2));
  const data = await readSharedRates();
  const history = data.history.map(normalizeHistoryEntry);
  const lastForMode = history.filter((row: any) => row.priceMode === mode).sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (lastForMode && lastForMode.goldRatePerTola === tola && lastForMode.goldRatePerGram === gram && lastForMode.date === today) {
    return { changed: false, history: data.history };
  }
  if (lastForMode) {
    const lastT = new Date(lastForMode.updatedAt).getTime();
    const minT = lastT + 1000;
    if (Date.now() < minT) now = new Date(minT).toISOString();
  }
  history.push({ date: today, goldRatePerTola: tola, goldRatePerGram: gram, priceMode: mode, updatedAt: now });
  data.history = trimHistory(history);
  await writeSharedRates(data);
  return { changed: true, history: data.history };
}

export async function getSharedRatesForClient({ date, priceMode }: { date: string; priceMode: string }) {
  const data = await readSharedRates();
  const mode = priceMode === 'api' ? 'api' : 'manual';
  const day = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const ticks = data.ticks.filter((row: any) => row.date === day && row.priceMode === mode).sort((a: any, b: any) => a.daySecond - b.daySecond || a.updatedAt.localeCompare(b.updatedAt));
  const history = data.history.filter((row: any) => row.priceMode === mode).sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt));
  return { ticks, history };
}

export async function clearSharedRates(priceMode: string) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  const data = await readSharedRates();
  data.ticks = data.ticks.filter((row: any) => row.priceMode !== mode);
  data.history = data.history.filter((row: any) => row.priceMode !== mode);
  const saved = await writeSharedRates(data);
  return { history: saved.history };
}

export { normalizeTick, normalizeHistoryEntry };
