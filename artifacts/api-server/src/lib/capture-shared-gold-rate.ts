import { getLiveMetalRates, isMetalApiConfigured, normalizeMetalCurrency, TOLA_GRAMS } from './metal-rates.js';
import { appendSharedHistory, appendSharedTicks } from './shared-rates.js';

// Defaults; override via env (FX_NPR_PER_USD / FX_NPR_PER_CAD) for the shared
// cron capture, which runs without a user context. Per-shop sales use the
// configurable Settings → fxRates instead.
const NPR_PER_UNIT: Record<string, number> = {
  USD: Number(process.env.FX_NPR_PER_USD) > 0 ? Number(process.env.FX_NPR_PER_USD) : 133,
  CAD: Number(process.env.FX_NPR_PER_CAD) > 0 ? Number(process.env.FX_NPR_PER_CAD) : 98,
  NPR: 1
};

export function localDateStr(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daySecondFromDate(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

export function displayToNpr(amount: number, currency: string): number {
  const requested = String(currency || 'USD').toUpperCase();
  const apiCode = normalizeMetalCurrency(requested);
  const factor = requested === 'NPR' ? NPR_PER_UNIT.USD : (NPR_PER_UNIT[apiCode] || NPR_PER_UNIT.USD);
  return Number(amount) * factor;
}

export async function captureSharedGoldRateIfChanged(options: any = {}) {
  if (!isMetalApiConfigured()) return { ok: false, skipped: true, reason: 'api_not_configured' };
  const currency = normalizeMetalCurrency(options.currency || process.env.CRON_METAL_CURRENCY || 'USD');
  const live = await getLiveMetalRates(currency);
  const tolaNpr = displayToNpr(live.gold.perTola, currency);
  const gramNpr = displayToNpr(live.gold.perGram, currency) || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  if (!tolaNpr || tolaNpr <= 0) return { ok: false, skipped: true, reason: 'invalid_rate' };
  const now = new Date();
  const result = await recordSharedApiGoldReading(tolaNpr, gramNpr, { localDate: options.localDate || localDateStr(now), now });
  return { ok: true, changed: result.changed, goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr, currency, source: live.source, liveUpdatedAt: live.updatedAt };
}

export async function recordSharedApiGoldReading(tolaNpr: number, gramNpr: number, options: any = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const result = await appendSharedHistory({ goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr, priceMode: 'api', localDate: options.localDate || localDateStr(now) });
  await appendSharedTicks([{ date: localDateStr(now), updatedAt: now.toISOString(), daySecond: daySecondFromDate(now), goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr, priceMode: 'api', saved: result.changed }]);
  return result;
}
