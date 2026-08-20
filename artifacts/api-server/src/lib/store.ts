import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseEnabled } from './supabase-client.js';
import {
  isMissingTableError, isMissingUserIdColumnError, isMissingColumnError,
  missingTablesMessage, missingUserIdMessage, missingCustomersAddressMessage
} from './db-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let customersAddressColumnSupported = true;
let customersTableAvailable = true;

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'store.json');
export const LOCAL_DEV_USER_ID = 'local-dev';

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
  );
}

function requireSupabaseInProduction() {
  if (!isServerlessRuntime() || isSupabaseEnabled()) return;
  throw new Error('Supabase is required in production. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

function rejectJsonFallback(err: any) {
  if (!isServerlessRuntime()) return;
  const message = String(err?.message || 'Connection failed');
  if (isMissingUserIdColumnError({ message }) || isMissingUserIdColumnError(err)) throw new Error(missingUserIdMessage());
  if (isMissingTableError({ message }) || isMissingTableError(err)) throw new Error(missingTablesMessage([]));
  throw new Error(`Database unavailable: ${message}`);
}

function throwIfError(error: any, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function userJsonPath(userId: string): string {
  return path.join(DATA_DIR, 'users', userId, 'store.json');
}

export function itemToRow(item: any, userId: string) {
  return {
    id: item.id, user_id: userId, sku: item.sku, name: item.name, category: item.category,
    karat: item.karat, weight_grams: item.weightGrams, making_charge: item.makingCharge ?? 0,
    jarti_rate_type: item.jartiRateType || 'flat',
    jarti_rate_value: item.jartiRateValue ?? 0,
    hallmark_number: item.hallmarkNumber || '',
    hallmark_date: item.hallmarkDate || '',
    purchase_cost: item.purchaseCost ?? 0, sale_price: item.salePrice ?? 0,
    custom_rate_per_tola: item.customRatePerTola ?? 0, quantity: item.quantity ?? 0,
    status: item.status, location: item.location || '', hallmark: Boolean(item.hallmark),
    notes: item.notes || '', created_at: item.createdAt, updated_at: item.updatedAt
  };
}

export function itemFromRow(row: any) {
  return {
    id: row.id, sku: row.sku, name: row.name, category: row.category, karat: Number(row.karat),
    weightGrams: Number(row.weight_grams), makingCharge: Number(row.making_charge) || 0,
    jartiRateType: row.jarti_rate_type || 'flat',
    jartiRateValue: Number(row.jarti_rate_value) || 0,
    hallmarkNumber: row.hallmark_number || '',
    hallmarkDate: row.hallmark_date || '',
    purchaseCost: Number(row.purchase_cost) || 0, salePrice: Number(row.sale_price) || 0,
    customRatePerTola: Number(row.custom_rate_per_tola) || 0, quantity: Number(row.quantity) || 0,
    status: row.status, location: row.location || '', hallmark: Boolean(row.hallmark),
    notes: row.notes || '', createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export const DEFAULT_FX_RATES: Record<string, number> = { USD: 133, CAD: 98 };

/** Extra settings persisted in a single jsonb column so old schemas keep working. */
export function settingsExtras(settings: any) {
  return {
    // Shop location + its sales-tax %. There are no columns for these, so they
    // ride along in `extras` — otherwise the location the shop picks
    // (Nepal / USA / Canada) is silently dropped on the next read.
    country: (settings.country ?? null) as string | null,
    salesTaxRate: Number(settings.salesTaxRate) || 0,
    fxRates: settings.fxRates || { ...DEFAULT_FX_RATES },
    fxUpdatedAt: settings.fxUpdatedAt || null,
    invoiceCounter: Number(settings.invoiceCounter) || 0,
    repairCounter: Number(settings.repairCounter) || 0,
    schemeCounter: Number(settings.schemeCounter) || 0,
    dueCounter: Number(settings.dueCounter) || 0
  };
}

export function settingsToRow(settings: any, userId: string) {
  return {
    user_id: userId, shop_name: settings.shopName, shop_address: settings.shopAddress || '',
    shop_phone: settings.shopPhone || '', shop_pan: settings.shopPan || '',
    vat_rate: settings.vatRate ?? 13, calendar_mode: settings.calendarMode || 'both',
    price_mode: settings.priceMode || 'manual',
    gold_rate_per_tola: settings.goldRatePerTola ?? 0, gold_rate_per_gram: settings.goldRatePerGram ?? 0,
    gold_buy_rate_per_tola: settings.goldBuyRatePerTola ?? 0, gold_buy_rate_per_gram: settings.goldBuyRatePerGram ?? 0,
    silver_rate_per_tola: settings.silverRatePerTola ?? 0, silver_rate_per_gram: settings.silverRatePerGram ?? 0,
    currency: settings.currency || 'NPR', locations: settings.locations || [],
    item_categories: settings.itemCategories || [], rate_history: settings.rateHistory || [],
    extras: settingsExtras(settings),
    updated_at: settings.updatedAt
  };
}

export function settingsFromRow(row: any) {
  if (!row) return defaultSettings();
  return {
    shopName: row.shop_name, shopAddress: row.shop_address || '', shopPhone: row.shop_phone || '',
    shopPan: row.shop_pan || '', vatRate: row.vat_rate != null ? Number(row.vat_rate) : 13,
    calendarMode: row.calendar_mode || 'both',
    priceMode: row.price_mode || 'manual', goldRatePerTola: Number(row.gold_rate_per_tola) || 0,
    goldRatePerGram: Number(row.gold_rate_per_gram) || 0, goldBuyRatePerTola: Number(row.gold_buy_rate_per_tola) || 0,
    goldBuyRatePerGram: Number(row.gold_buy_rate_per_gram) || 0, silverRatePerTola: Number(row.silver_rate_per_tola) || 0,
    silverRatePerGram: Number(row.silver_rate_per_gram) || 0, currency: row.currency || 'NPR',
    locations: row.locations || [], itemCategories: row.item_categories || [],
    rateHistory: row.rate_history || [], updatedAt: row.updated_at,
    country: (row.extras?.country ?? null) as string | null,
    salesTaxRate: Number(row.extras?.salesTaxRate) || 0,
    fxRates: (row.extras && row.extras.fxRates) || { ...DEFAULT_FX_RATES },
    fxUpdatedAt: (row.extras && row.extras.fxUpdatedAt) || null,
    invoiceCounter: Number(row.extras?.invoiceCounter) || 0,
    repairCounter: Number(row.extras?.repairCounter) || 0,
    schemeCounter: Number(row.extras?.schemeCounter) || 0,
    dueCounter: Number(row.extras?.dueCounter) || 0
  };
}

function transactionToRow(tx: any, userId: string) {
  return {
    id: tx.id, user_id: userId, type: tx.type, item_id: tx.itemId || null,
    item_name: tx.itemName || null, quantity: tx.quantity ?? 0, amount: tx.amount ?? null,
    note: tx.note || '', created_at: tx.createdAt
  };
}

function transactionFromRow(row: any) {
  return {
    id: row.id, type: row.type, itemId: row.item_id, itemName: row.item_name,
    quantity: Number(row.quantity) || 0, amount: row.amount != null ? Number(row.amount) : undefined,
    note: row.note || '', createdAt: row.created_at
  };
}

function orderToRow(order: any, userId: string) {
  return {
    id: order.id, user_id: userId, order_number: order.orderNumber, customer_name: order.customerName,
    customer_phone: order.customerPhone || '', status: order.status,
    // Persist optional payment/gold fields inside lines JSON so they survive without new DB columns.
    lines: {
      items: order.lines || [],
      customerGoldGrams: order.customerGoldGrams ?? 0,
      goldAddedGrams: order.goldAddedGrams ?? 0,
      remainingPayment: order.remainingPayment == null
        ? null
        : order.remainingPayment
    },
    total_amount: order.totalAmount ?? 0, note: order.note || '',
    karigar_id: order.karigarId || null, karigar_name: order.karigarName || '',
    advance_amount: order.advanceAmount ?? 0, advance_paid: Boolean(order.advancePaid),
    created_at: order.createdAt, updated_at: order.updatedAt
  };
}

function orderFromRow(row: any) {
  const totalAmount = Number(row.total_amount) || 0;
  const advanceAmount = Number(row.advance_amount) || 0;
  const rawLines = row.lines;
  let lines = [];
  let customerGoldGrams = 0;
  let goldAddedGrams = 0;
  let remainingPayment = null;
  if (Array.isArray(rawLines)) {
    lines = rawLines;
  } else if (rawLines && typeof rawLines === 'object') {
    lines = Array.isArray(rawLines.items) ? rawLines.items : [];
    customerGoldGrams = Number(rawLines.customerGoldGrams) || 0;
    goldAddedGrams = Number(rawLines.goldAddedGrams) || 0;
    if (rawLines.remainingPayment != null) remainingPayment = Number(rawLines.remainingPayment) || 0;
  }
  return {
    id: row.id, orderNumber: row.order_number, customerName: row.customer_name,
    customerPhone: row.customer_phone || '', status: row.status, lines,
    totalAmount, note: row.note || '',
    karigarId: row.karigar_id || null, karigarName: row.karigar_name || '',
    advanceAmount, advancePaid: Boolean(row.advance_paid),
    customerGoldGrams, goldAddedGrams, remainingPayment,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function customerToRow(customer: any, userId: string) {
  const row: any = {
    id: customer.id, user_id: userId, name: customer.name, phone: customer.phone || '',
    email: customer.email || '', created_at: customer.createdAt || new Date().toISOString()
  };
  if (customersAddressColumnSupported) row.address = customer.address || '';
  return row;
}

function customerFromRow(row: any) {
  return {
    id: row.id, name: row.name, phone: row.phone || '', email: row.email || '',
    address: row.address || '', createdAt: row.created_at, purchases: 0
  };
}

export function defaultSettings() {
  return {
    shopName: 'SubarnaPasal', shopAddress: '', shopPhone: '', shopPan: '', vatRate: 13, calendarMode: 'both', priceMode: 'manual',
    country: null as string | null, salesTaxRate: 0,
    goldRatePerTola: 0, goldRatePerGram: 0, goldBuyRatePerTola: 0, goldBuyRatePerGram: 0,
    silverRatePerTola: 0, silverRatePerGram: 0, currency: 'NPR',
    locations: ['Desk A', 'Desk B', 'Side Desk'], itemCategories: ['Gold', 'Silver', 'Other'],
    rateHistory: [], updatedAt: new Date().toISOString(),
    fxRates: { ...DEFAULT_FX_RATES }, fxUpdatedAt: null,
    invoiceCounter: 0, repairCounter: 0, schemeCounter: 0, dueCounter: 0, requestCounter: 0
  };
}

/** Collections synced to Supabase as generic (user_id, id, data jsonb) rows. */
const JSONB_COLLECTIONS: Array<{ key: string; table: string }> = [
  { key: 'karigars', table: 'karigars' },
  { key: 'goldLedger', table: 'gold_ledger' },
  { key: 'oldGoldExchanges', table: 'old_gold_exchanges' },
  { key: 'options', table: 'options' },
  { key: 'sales', table: 'sales' },
  { key: 'repairs', table: 'repairs' },
  { key: 'schemes', table: 'schemes' },
  { key: 'requests', table: 'requests' }
];

const missingJsonbTables = new Set<string>();

function emptyStore() {
  return {
    settings: defaultSettings(),
    items: [] as any[],
    transactions: [] as any[],
    orders: [] as any[],
    customers: [] as any[],
    karigars: [] as any[],
    goldLedger: [] as any[],
    oldGoldExchanges: [] as any[],
    options: [] as any[],
    sales: [] as any[],
    repairs: [] as any[],
    schemes: [] as any[],
    requests: [] as any[]
  };
}

function readJsonStore(userId = LOCAL_DEV_USER_ID) {
  const userFile = userJsonPath(userId);
  if (fs.existsSync(userFile)) {
    const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    return {
      settings: data.settings || defaultSettings(),
      items: data.items || [],
      transactions: data.transactions || [],
      orders: data.orders || [],
      customers: data.customers || [],
      karigars: data.karigars || [],
      goldLedger: data.goldLedger || [],
      oldGoldExchanges: data.oldGoldExchanges || [],
      options: data.options || [],
      sales: data.sales || [],
      repairs: data.repairs || [],
      schemes: data.schemes || [],
      requests: data.requests || []
    };
  }
  if (userId === LOCAL_DEV_USER_ID && fs.existsSync(LEGACY_DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8'));
    return {
      settings: data.settings || defaultSettings(),
      items: data.items || [],
      transactions: data.transactions || [],
      orders: data.orders || [],
      customers: data.customers || [],
      karigars: data.karigars || [],
      goldLedger: data.goldLedger || [],
      oldGoldExchanges: data.oldGoldExchanges || [],
      options: data.options || [],
      sales: data.sales || [],
      repairs: data.repairs || [],
      schemes: data.schemes || [],
      requests: data.requests || []
    };
  }
  return emptyStore();
}

function writeJsonStore(data: any, userId = LOCAL_DEV_USER_ID) {
  const userFile = userJsonPath(userId);
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, JSON.stringify(data, null, 2));
}

async function syncCustomersTable(supabase: any, customers: any[], userId: string) {
  if (!customersTableAvailable) return;
  const rows = (customers || []).map((customer) => customerToRow(customer, userId));
  const { data: existing, error: fetchError } = await supabase.from('customers').select('id').eq('user_id', userId);
  if (fetchError) {
    if (isMissingTableError(fetchError)) { customersTableAvailable = false; console.warn('Customers table missing.'); return; }
    throwIfError(fetchError, 'Failed to read customers');
  }
  const keepIds = new Set(rows.map((row: any) => row.id));
  const deleteIds = (existing || []).map((row: any) => row.id).filter((id: string) => !keepIds.has(id));
  if (deleteIds.length) { const { error: deleteError } = await supabase.from('customers').delete().eq('user_id', userId).in('id', deleteIds); throwIfError(deleteError, 'Failed to delete from customers'); }
  if (!rows.length) return;
  let { error: upsertError } = await supabase.from('customers').upsert(rows, { onConflict: 'user_id,id' });
  if (upsertError && customersAddressColumnSupported && isMissingColumnError(upsertError, 'address')) {
    customersAddressColumnSupported = false;
    const rowsWithoutAddress = (customers || []).map((customer) => customerToRow(customer, userId));
    ({ error: upsertError } = await supabase.from('customers').upsert(rowsWithoutAddress, { onConflict: 'user_id,id' }));
    console.warn(missingCustomersAddressMessage());
  }
  if (upsertError && isMissingTableError(upsertError)) { customersTableAvailable = false; console.warn('Customers table missing.'); return; }
  throwIfError(upsertError, 'Failed to upsert customers');
}

async function syncTable(supabase: any, table: string, rows: any[], userId: string, idField = 'id') {
  const { data: existing, error: fetchError } = await supabase.from(table).select(idField).eq('user_id', userId);
  throwIfError(fetchError, `Failed to read ${table}`);
  const keepIds = new Set(rows.map((row) => row[idField]));
  const deleteIds = (existing || []).map((row: any) => row[idField]).filter((id: any) => !keepIds.has(id));
  if (deleteIds.length) { const { error } = await supabase.from(table).delete().eq('user_id', userId).in(idField, deleteIds); throwIfError(error, `Failed to delete from ${table}`); }
  if (!rows.length) return;
  const { error: upsertError } = await supabase.from(table).upsert(rows, { onConflict: `user_id,${idField}` });
  throwIfError(upsertError, `Failed to upsert ${table}`);
}

export async function ensureUserSettings(supabase: any, userId: string) {
  const { data: existing, error } = await supabase.from('settings').select('user_id').eq('user_id', userId).maybeSingle();
  throwIfError(error, 'Failed to check settings');
  if (existing) return;
  const { error: insertError } = await supabase.from('settings').insert(settingsToRow(defaultSettings(), userId));
  throwIfError(insertError, 'Failed to create default settings');
}

/**
 * Read a generic (user_id, id, data jsonb) collection table.
 * Returns null when the table doesn't exist yet, so the caller can
 * fall back to the local JSON copy instead of clobbering data.
 */
async function readJsonbCollection(supabase: any, table: string, userId: string): Promise<any[] | null> {
  if (missingJsonbTables.has(table)) return null;
  const { data, error } = await supabase.from(table).select('id, data').eq('user_id', userId);
  if (error) {
    if (isMissingTableError(error)) {
      missingJsonbTables.add(table);
      console.warn(`Table "${table}" missing in Supabase — keeping this data in local JSON only. Run supabase/pos-upgrade.sql to persist it.`);
      return null;
    }
    throw new Error(`Failed to load ${table}: ${error.message}`);
  }
  return (data || []).map((row: any) => row.data).filter(Boolean);
}

async function syncJsonbCollection(supabase: any, table: string, records: any[], userId: string) {
  if (missingJsonbTables.has(table)) return;
  const rows = (records || [])
    .filter((r: any) => r && r.id != null)
    .map((r: any) => ({ id: String(r.id), user_id: userId, data: r }));
  const { data: existing, error: fetchError } = await supabase.from(table).select('id').eq('user_id', userId);
  if (fetchError) {
    if (isMissingTableError(fetchError)) { missingJsonbTables.add(table); return; }
    throw new Error(`Failed to read ${table}: ${fetchError.message}`);
  }
  const keepIds = new Set(rows.map((row: any) => row.id));
  const deleteIds = (existing || []).map((row: any) => row.id).filter((id: string) => !keepIds.has(id));
  if (deleteIds.length) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId).in('id', deleteIds);
    throwIfError(error, `Failed to delete from ${table}`);
  }
  if (!rows.length) return;
  const { error: upsertError } = await supabase.from(table).upsert(rows, { onConflict: 'user_id,id' });
  if (upsertError && isMissingTableError(upsertError)) { missingJsonbTables.add(table); return; }
  throwIfError(upsertError, `Failed to upsert ${table}`);
}

let settingsExtrasColumnSupported = true;

async function upsertSettingsRow(supabase: any, settings: any, userId: string) {
  const row = settingsToRow(settings, userId);
  if (!settingsExtrasColumnSupported) delete (row as any).extras;
  let { error } = await supabase.from('settings').upsert(row, { onConflict: 'user_id' });
  if (error && settingsExtrasColumnSupported && isMissingColumnError(error, 'extras')) {
    settingsExtrasColumnSupported = false;
    console.warn('Settings table is missing the "extras" column — FX rates and counters persist in local JSON only. Run supabase/pos-upgrade.sql.');
    delete (row as any).extras;
    ({ error } = await supabase.from('settings').upsert(row, { onConflict: 'user_id' }));
  }
  throwIfError(error, 'Failed to save settings');
}

async function readSupabaseStore(userId: string) {
  const supabase = getSupabase();
  await ensureUserSettings(supabase, userId);
  const [
    { data: settingsRows, error: settingsError }, { data: itemRows, error: itemsError },
    { data: txRows, error: txError }, { data: orderRows, error: ordersError },
    { data: customerRows, error: customersError }
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('items').select('*').eq('user_id', userId),
    supabase.from('transactions').select('*').eq('user_id', userId),
    supabase.from('orders').select('*').eq('user_id', userId),
    supabase.from('customers').select('*').eq('user_id', userId)
  ]);
  throwIfError(settingsError, 'Failed to load settings');
  throwIfError(itemsError, 'Failed to load items');
  throwIfError(txError, 'Failed to load transactions');
  throwIfError(ordersError, 'Failed to load orders');
  if (customersError) {
    if (isMissingTableError(customersError)) { customersTableAvailable = false; console.warn('Customers table missing.'); }
    else throwIfError(customersError, 'Failed to load customers');
  }
  const store: any = {
    settings: settingsFromRow(settingsRows),
    items: (itemRows || []).map(itemFromRow),
    transactions: (txRows || []).map(transactionFromRow),
    orders: (orderRows || []).map(orderFromRow),
    customers: (customerRows || []).map(customerFromRow)
  };
  // Generic jsonb collections. When a table is missing, keep whatever the
  // local JSON copy has instead of returning [] (which would wipe the mirror).
  let localFallback: any = null;
  for (const { key, table } of JSONB_COLLECTIONS) {
    const records = await readJsonbCollection(supabase, table, userId);
    if (records === null) {
      if (!localFallback) { try { localFallback = readJsonStore(userId); } catch { localFallback = emptyStore(); } }
      store[key] = localFallback[key] || [];
    } else {
      store[key] = records;
    }
  }
  // Same guard for settings extras: if the column isn't there, keep local values.
  if (settingsRows && settingsRows.extras == null) {
    if (!localFallback) { try { localFallback = readJsonStore(userId); } catch { localFallback = emptyStore(); } }
    const localSettings = localFallback.settings || {};
    store.settings.fxRates = localSettings.fxRates || store.settings.fxRates;
    store.settings.fxUpdatedAt = localSettings.fxUpdatedAt || store.settings.fxUpdatedAt;
    store.settings.invoiceCounter = Math.max(Number(localSettings.invoiceCounter) || 0, store.settings.invoiceCounter || 0);
    store.settings.repairCounter = Math.max(Number(localSettings.repairCounter) || 0, store.settings.repairCounter || 0);
    store.settings.schemeCounter = Math.max(Number(localSettings.schemeCounter) || 0, store.settings.schemeCounter || 0);
  }
  return store;
}

async function writeSupabaseStore(data: any, userId: string) {
  const supabase = getSupabase();
  await ensureUserSettings(supabase, userId);
  await upsertSettingsRow(supabase, data.settings, userId);
  await syncTable(supabase, 'items', data.items.map((item: any) => itemToRow(item, userId)), userId);
  await syncTable(supabase, 'transactions', data.transactions.map((tx: any) => transactionToRow(tx, userId)), userId);
  await syncTable(supabase, 'orders', data.orders.map((order: any) => orderToRow(order, userId)), userId);
  await syncCustomersTable(supabase, data.customers || [], userId);
  for (const { key, table } of JSONB_COLLECTIONS) {
    await syncJsonbCollection(supabase, table, data[key] || [], userId);
  }
}

/** Users currently reading/writing from local because the server DB failed on the last attempt. */
const jsonFallbackUsers = new Set<string>();

function mirrorToLocal(data: any, userId: string) {
  try {
    writeJsonStore(data, userId);
  } catch (err: any) {
    console.warn(`Local JSON mirror failed for user ${userId}: ${err.message}`);
  }
}

/**
 * Prefer the server (Supabase) database. Always keep a local JSON mirror.
 * If the server is unavailable, fall back to local JSON.
 */
export async function readStore(userId: string) {
  if (!userId) throw new Error('User id is required.');
  requireSupabaseInProduction();
  if (!isSupabaseEnabled()) return readJsonStore(userId);
  try {
    const data = await readSupabaseStore(userId);
    jsonFallbackUsers.delete(userId);
    // Keep local in sync with the server source of truth.
    mirrorToLocal(data, userId);
    return data;
  } catch (err: any) {
    rejectJsonFallback(err);
    if (!jsonFallbackUsers.has(userId)) {
      console.warn(`Supabase unavailable for user ${userId} (${err.message}), using local JSON.`);
    }
    jsonFallbackUsers.add(userId);
    return readJsonStore(userId);
  }
}

/**
 * Always write to the server when available, and always save a local copy too.
 * If the server write fails, still save locally (and retry the server on the next write).
 */
export async function writeStore(data: any, userId: string) {
  if (!userId) throw new Error('User id is required.');
  requireSupabaseInProduction();

  // Local mirror is always attempted so offline recovery stays current.
  mirrorToLocal(data, userId);

  if (!isSupabaseEnabled()) return;

  try {
    await writeSupabaseStore(data, userId);
    jsonFallbackUsers.delete(userId);
  } catch (err: any) {
    rejectJsonFallback(err);
    console.warn(`Supabase write failed for user ${userId} (${err.message}), local JSON already saved.`);
    jsonFallbackUsers.add(userId);
  }
}

export function dataSourceLabel(): string {
  if (!isSupabaseEnabled()) return `JSON (${DATA_DIR}/users/)`;
  if (jsonFallbackUsers.size) {
    return `Supabase + local JSON mirror (currently on local fallback for ${jsonFallbackUsers.size} user(s))`;
  }
  return `Supabase + local JSON mirror (${DATA_DIR}/users/)`;
}

export function normalizeShopName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

/**
 * Every user id that has a local store on disk. Used to map a customer-link
 * code back to the shop it belongs to (routes/api.ts, /public/:code/...).
 */
export function listStoreUserIds(): string[] {
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return [];
  try {
    return fs.readdirSync(usersDir).filter((uid) => {
      try { return fs.statSync(path.join(usersDir, uid)).isDirectory(); } catch (_) { return false; }
    });
  } catch (_) {
    return [];
  }
}

export async function isShopNameTaken(shopName: string, excludeUserId: string): Promise<boolean> {
  const normalized = normalizeShopName(shopName);
  if (!normalized) return false;
  if (isSupabaseEnabled()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('settings').select('user_id').neq('user_id', excludeUserId).ilike('shop_name', normalized);
    throwIfError(error, 'Failed to check shop name');
    return (data || []).length > 0;
  }
  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return false;
  for (const uid of fs.readdirSync(usersDir)) {
    if (uid === excludeUserId) continue;
    try { const store = readJsonStore(uid); if (normalizeShopName(store.settings?.shopName) === normalized) return true; } catch (_) { /* skip */ }
  }
  return false;
}
