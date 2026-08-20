const TROY_OZ_GRAMS = 31.1034768;
export const TOLA_GRAMS = 11.66;
const CACHE_MS = 5 * 60 * 1000;

const cacheByCurrency = new Map<string, { data: any; expiresAt: number }>();
const METAL_CURRENCIES = ['USD', 'CAD'];

export function normalizeMetalCurrency(currency: string): string {
  const code = String(currency || 'USD').toUpperCase();
  if (code === 'NPR') return 'USD';
  return METAL_CURRENCIES.includes(code) ? code : 'USD';
}

function round(value: number, digits: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

export function getProvider(): string {
  return (process.env.METAL_PRICE_PROVIDER || 'gold-api').toLowerCase();
}

function buildMetalQuote(usdPerOz: number) {
  const perGram = usdPerOz / TROY_OZ_GRAMS;
  const perTola = perGram * TOLA_GRAMS;
  return { perOz: round(usdPerOz, 2), perGram: round(perGram, 4), perTola: round(perTola, 2) };
}

function goldApiTimestamp(value: any): string {
  if (!value) return new Date().toISOString();
  const n = Number(value);
  if (Number.isFinite(n)) {
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  return String(value);
}

function buildMetalQuoteFromGoldApiIo(payload: any) {
  const perOz = Number(payload.price);
  if (!Number.isFinite(perOz) || perOz <= 0) throw new Error('GoldAPI.io returned invalid spot price.');
  const perGram24k = Number(payload.price_gram_24k);
  const perGram = Number.isFinite(perGram24k) && perGram24k > 0 ? perGram24k : perOz / TROY_OZ_GRAMS;
  const perTola = perGram * TOLA_GRAMS;
  const quote: any = {
    perOz: round(perOz, 2), perGram: round(perGram, 4), perTola: round(perTola, 2),
    bid: payload.bid != null ? round(payload.bid, 2) : null,
    ask: payload.ask != null ? round(payload.ask, 2) : null
  };
  if (payload.price_gram_22k != null) {
    quote.karatPerGram = {
      k24: round(payload.price_gram_24k, 4), k22: round(payload.price_gram_22k, 4),
      k21: round(payload.price_gram_21k, 4), k20: round(payload.price_gram_20k, 4), k18: round(payload.price_gram_18k, 4)
    };
  }
  return quote;
}

function getApiKey(): string {
  return String(process.env.METAL_PRICE_API_KEY || process.env.GOLD_API_KEY || '').trim();
}

export function hasValidApiKey(): boolean {
  const key = getApiKey();
  return Boolean(key && !key.includes('your-') && key !== 'your-api-key' && key !== 'your-goldapi-key');
}

function usesGoldApiCom(): boolean {
  const provider = getProvider();
  return provider === 'gold-api' || provider === 'gold-api.com';
}

async function fetchJson(url: string, options: any = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options, signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SubarnaPasal/1.0', ...(options.headers || {}) }
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error || data.message || data.detail || res.statusText;
      throw new Error(message || `Metal API request failed (${res.status})`);
    }
    return data;
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Metal price API timed out. Try again in a moment.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromGoldApiCom(currency = 'USD') {
  const code = normalizeMetalCurrency(currency);
  const [gold, silver] = await Promise.all([
    fetchJson(`https://api.gold-api.com/price/XAU/${code}`),
    fetchJson(`https://api.gold-api.com/price/XAG/${code}`)
  ]);
  const goldOz = Number(gold.price);
  const silverOz = Number(silver.price);
  if (!Number.isFinite(goldOz) || !Number.isFinite(silverOz)) throw new Error('gold-api.com returned invalid prices.');
  return { currency: gold.currency || silver.currency || 'USD', source: 'gold-api.com', updatedAt: gold.updatedAt || silver.updatedAt || new Date().toISOString(), gold: buildMetalQuote(goldOz), silver: buildMetalQuote(silverOz) };
}

async function fetchFromGoldApiIo() {
  const key = getApiKey();
  const headers = { 'x-access-token': key };
  const [gold, silver] = await Promise.all([
    fetchJson('https://www.goldapi.io/api/XAU/USD', { headers }),
    fetchJson('https://www.goldapi.io/api/XAG/USD', { headers })
  ]);
  return { currency: 'USD', source: 'goldapi.io', exchange: gold.exchange || silver.exchange || null, updatedAt: goldApiTimestamp(gold.timestamp || silver.timestamp), gold: buildMetalQuoteFromGoldApiIo(gold), silver: buildMetalQuoteFromGoldApiIo(silver) };
}

async function fetchFromMetalsApi() {
  const key = getApiKey();
  const url = new URL('https://metals-api.com/api/latest');
  url.searchParams.set('access_key', key);
  url.searchParams.set('base', 'USD');
  url.searchParams.set('symbols', 'XAU,XAG');
  const data: any = await fetchJson(url.toString());
  const goldRate = Number(data.rates?.XAU);
  const silverRate = Number(data.rates?.XAG);
  if (!Number.isFinite(goldRate) || !Number.isFinite(silverRate) || goldRate <= 0 || silverRate <= 0) throw new Error('Metals-API returned invalid prices.');
  return { currency: 'USD', source: 'metals-api', updatedAt: data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString(), gold: buildMetalQuote(1 / goldRate), silver: buildMetalQuote(1 / silverRate) };
}

export function isMetalApiConfigured(): boolean {
  const provider = getProvider();
  if (usesGoldApiCom()) return true;
  if (provider === 'metals-api' || provider === 'goldapi' || provider === 'goldapi.io') return hasValidApiKey();
  return true;
}

export async function getLiveMetalRates(currency = 'USD') {
  if (!isMetalApiConfigured()) {
    const err: any = new Error('Live metal API is not configured.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const code = normalizeMetalCurrency(currency);
  const cached = cacheByCurrency.get(code);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const provider = getProvider();
  let data: any;
  if (provider === 'metals-api' && hasValidApiKey()) data = await fetchFromMetalsApi();
  else if ((provider === 'goldapi' || provider === 'goldapi.io') && hasValidApiKey()) data = await fetchFromGoldApiIo();
  else data = await fetchFromGoldApiCom(code);
  cacheByCurrency.set(code, { data, expiresAt: Date.now() + CACHE_MS });
  return data;
}
