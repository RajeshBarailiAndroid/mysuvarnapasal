import { Router } from 'express';
import crypto from 'crypto';
import {
  readStore, writeStore, dataSourceLabel, isShopNameTaken, normalizeShopName, DEFAULT_FX_RATES,
  listStoreUserIds, LOCAL_DEV_USER_ID
} from '../lib/store.js';
import {
  readSharedRates, appendSharedTicks, appendSharedHistory,
  getSharedRatesForClient, clearSharedRates
} from '../lib/shared-rates.js';
import { getSupabase, checkSupabaseConnection } from '../lib/supabase-client.js';
import {
  getLiveMetalRates, isMetalApiConfigured, getProvider, normalizeMetalCurrency, TOLA_GRAMS
} from '../lib/metal-rates.js';
import { captureSharedGoldRateIfChanged, displayToNpr, localDateStr } from '../lib/capture-shared-gold-rate.js';
import { isValidPhoneForRegion, normalizePhoneRegion, phoneErrorMessage, isValidPhone } from '../lib/phone.js';

const router = Router();

const AANA_PER_TOLA = 16;
const LAAL_PER_AANA = 6.25;
const LAAL_PER_TOLA = AANA_PER_TOLA * LAAL_PER_AANA;

/**
 * NPR per unit of a display currency. Reads the shop's configurable FX rates
 * (Settings → fxRates) and falls back to the built-in defaults. The value used
 * for any sale is snapshotted onto the invoice at checkout.
 */
function fxNprPerUnit(settings: any, code: string): number {
  const c = String(code || 'USD').toUpperCase();
  if (c === 'NPR') return 1;
  const table: Record<string, number> = { ...DEFAULT_FX_RATES, ...((settings && settings.fxRates) || {}) };
  const v = Number(table[c]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_FX_RATES.USD;
}

function asyncRoute(fn: (req: any, res: any) => Promise<any>) {
  return (req: any, res: any, next: any) => fn(req, res).catch(next);
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function silverRatePerTolaFromSettings(settings: any): number {
  if (settings.silverRatePerTola != null && Number(settings.silverRatePerTola) > 0) return Number(settings.silverRatePerTola);
  const perGram = Number(settings.silverRatePerGram) || 0;
  return perGram > 0 ? Number((perGram * TOLA_GRAMS).toFixed(2)) : 0;
}

function normalizeSilverRates(settings: any) {
  const silverRatePerTola = silverRatePerTolaFromSettings(settings);
  settings.silverRatePerTola = silverRatePerTola;
  settings.silverRatePerGram = Number((silverRatePerTola / TOLA_GRAMS).toFixed(2));
  return settings;
}

function getStoreLocations(store: any): string[] {
  if (Array.isArray(store.settings.locations) && store.settings.locations.length) {
    return store.settings.locations.map((l: any) => String(l).trim()).filter(Boolean);
  }
  const fromItems = [...new Set(store.items.map((i: any) => i.location).filter(Boolean))];
  if (fromItems.length) return fromItems as string[];
  return ['Desk A', 'Desk B', 'Side Desk'];
}

const DEFAULT_ITEM_CATEGORIES = ['Gold', 'Silver', 'Other'];

function normalizeItemCategories(list: any[]): string[] {
  const items = [...new Set((Array.isArray(list) ? list : []).map((c) => String(c).trim()).filter(Boolean))];
  ['Gold', 'Silver', 'Other'].forEach((name) => { if (!items.some((c: any) => c.toLowerCase() === name.toLowerCase())) items.push(name); });
  return items;
}

function getStoreItemCategories(store: any): string[] {
  if (Array.isArray(store.settings.itemCategories) && store.settings.itemCategories.length) return normalizeItemCategories(store.settings.itemCategories);
  return [...DEFAULT_ITEM_CATEGORIES];
}

function validateCustomerPhone(phone: string, phoneRegion: string): string | null {
  if (!phone) return null;
  if (phoneRegion) {
    return isValidPhoneForRegion(phone, phoneRegion) ? null : phoneErrorMessage(normalizePhoneRegion(phoneRegion));
  }
  return isValidPhone(phone) ? null : 'Enter a valid phone number for Nepal, US, or Canada.';
}

function customerMatchKey(name: string, phone: string): string {
  return `${String(name || '').trim().toLowerCase()}|${String(phone || '').trim()}`;
}

function parseCustomerNameFromSaleNote(note: string): string {
  const text = String(note || '');
  const pos = text.match(/^POS — ([^·]+)/);
  return pos ? pos[1].trim() : '';
}

function computeCustomerPurchaseCounts(store: any): Map<string, number> {
  const counts = new Map<string, number>();
  (store.orders || []).forEach((order: any) => {
    if (order.status !== 'completed' || !order.customerName) return;
    const key = customerMatchKey(order.customerName, order.customerPhone);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  (store.transactions || []).forEach((tx: any) => {
    if (tx.type !== 'sale') return;
    const name = parseCustomerNameFromSaleNote(tx.note);
    if (!name) return;
    const key = customerMatchKey(name, '');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function syncCustomersFromOrders(store: any): boolean {
  const customers = [...(store.customers || [])];
  const byKey = new Map(customers.map((c: any) => [customerMatchKey(c.name, c.phone), c]));
  let changed = false;
  (store.orders || []).forEach((order: any) => {
    const name = String(order.customerName || '').trim();
    if (!name) return;
    const phone = String(order.customerPhone || '').trim();
    const key = customerMatchKey(name, phone);
    if (byKey.has(key)) return;
    const customer = { id: newId('c'), name, phone, email: '', address: '', createdAt: order.createdAt || new Date().toISOString(), purchases: 0 };
    customers.push(customer);
    byKey.set(key, customer);
    changed = true;
  });
  if (changed) store.customers = customers;
  return changed;
}

function listCustomersWithActivity(store: any): any[] {
  syncCustomersFromOrders(store);
  const purchaseCounts = computeCustomerPurchaseCounts(store);
  return (store.customers || [])
    .map((customer: any) => ({ ...customer, purchases: purchaseCounts.get(customerMatchKey(customer.name, customer.phone)) || 0 }))
    .sort((a: any, b: any) => b.purchases - a.purchases || a.name.localeCompare(b.name));
}

function upsertCustomerInStore(store: any, payload: any): any | null {
  const name = String(payload.name || '').trim();
  if (!name) return null;
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim();
  const address = String(payload.address || '').trim();
  const customers = [...(store.customers || [])];
  const key = customerMatchKey(name, phone);
  let customer = customers.find((c: any) => customerMatchKey(c.name, c.phone) === key);
  if (customer) {
    if (phone && !customer.phone) customer.phone = phone;
    if (email && !customer.email) customer.email = email;
    if (address && !customer.address) customer.address = address;
  } else {
    customer = { id: newId('c'), name, phone, email, address, createdAt: new Date().toISOString(), purchases: 0 };
    customers.unshift(customer);
  }
  store.customers = customers;
  return customer;
}

// Live/API metal pricing was removed. Gold and silver always come from the rate
// the shop saved in Settings, so the till, the dashboard, the reports and every
// printed bill quote the same number.
async function resolveMetalRates(store: any): Promise<any> {
  return {
    live: false, currency: null,
    goldRatePerTola: store.settings.goldRatePerTola,
    goldRatePerGram: store.settings.goldRatePerGram ?? Number((store.settings.goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola: store.settings.silverRatePerTola,
    silverRatePerGram: store.settings.silverRatePerGram,
    fx: { currency: 'NPR', nprPerUnit: 1, updatedAt: store.settings.fxUpdatedAt || null }
  };
}

function gramsToTola(grams: number): number { return Number((grams / TOLA_GRAMS).toFixed(3)); }
function itemMetalType(item: any): string {
  const slug = String(item?.category || '').trim().toLowerCase();
  if (slug === 'silver') return 'silver';
  if (slug === 'other') return 'other';
  return 'gold';
}
function itemValue(item: any, rates: any): number {
  const goldRate = typeof rates === 'object' && rates != null ? Number(rates.goldRatePerTola) || 0 : Number(rates) || 0;
  const silverRate = typeof rates === 'object' && rates != null ? Number(rates.silverRatePerTola) || 0 : 0;
  const weightTola = gramsToTola(item.weightGrams);
  const making = Number(item.makingCharge) || 0;
  const metal = itemMetalType(item);
  let metalValue = 0;
  let rate = 0;
  let karatFactor = 1;
  if (metal === 'silver') {
    rate = silverRate;
    metalValue = weightTola * silverRate;
  } else if (metal === 'other') {
    rate = Number(item.customRatePerTola) || 0;
    if (!rate) { const sale = Number(item.salePrice); if (sale > 0) return Math.round(sale); return Math.round(making); }
    metalValue = weightTola * rate;
  } else {
    rate = goldRate;
    karatFactor = (Number(item.karat) || 24) / 24;
    metalValue = weightTola * goldRate * karatFactor;
  }
  const jarti = calcJartiAmountServer({
    jartiRateType: item.jartiRateType,
    jartiRateValue: item.jartiRateValue,
    weightGrams: item.weightGrams,
    metalValue,
    ratePerTola: rate,
    karatFactor
  });
  return Math.round(metalValue + making + jarti);
}
function calcJartiAmountServer({ jartiRateType = 'flat', jartiRateValue = 0, weightGrams = 0, metalValue = 0, ratePerTola = 0, karatFactor = 1 }: any): number {
  const value = Number(jartiRateValue) || 0;
  if (value <= 0) return 0;
  const grams = Number(weightGrams) || 0;
  const metal = Number(metalValue) || 0;
  const type = String(jartiRateType || 'flat');
  if (type === 'percent' || type === 'grams') {
    const jartiGrams = resolveJartiWeightGramsServer(grams, type, value);
    if (jartiGrams <= 0) return 0;
    if (Number(ratePerTola) > 0) return jartiGrams * (Number(ratePerTola) / TOLA_GRAMS) * (Number(karatFactor) || 1);
    if (type === 'percent' && metal > 0) return (metal * value) / 100;
    return 0;
  }
  switch (type) {
    case 'per_gram': return grams > 0 ? value * grams : 0;
    case 'per_tola': return grams > 0 ? value * (grams / TOLA_GRAMS) : 0;
    case 'flat':
    default: return value;
  }
}
function resolveJartiWeightGramsServer(weightGrams: number, jartiRateType = 'percent', jartiRateValue = 0): number {
  const value = Number(jartiRateValue) || 0;
  if (value <= 0) return 0;
  const grams = Number(weightGrams) || 0;
  if (String(jartiRateType) === 'grams') return value;
  if (String(jartiRateType) === 'percent') return grams > 0 ? (grams * value) / 100 : 0;
  return 0;
}
function isItemSoldOut(item: any): boolean { return Boolean(item && (item.status === 'sold_out' || Number(item.quantity) <= 0)); }
function normalizeItemRecord(item: any, { isNew = false } = {}): any {
  const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
  const status = String(item.status || 'in_stock');
  if (status === 'sold_out') { item.quantity = 0; item.status = 'sold_out'; return item; }
  if (status === 'in_stock' && qty === 0) { if (isNew) { item.quantity = 1; item.status = 'in_stock'; } else { item.quantity = 0; item.status = 'sold_out'; } return item; }
  if (qty > 0 && status === 'sold_out') { if (isNew) { item.quantity = qty; item.status = 'in_stock'; } else { item.quantity = 0; item.status = 'sold_out'; } return item; }
  item.quantity = qty; item.status = status; return item;
}
function validateInventoryMetalFields(body: any): string | null {
  const category = String(body.category || 'gold').trim().toLowerCase();
  const metal = itemMetalType({ category });
  if (metal === 'other' && !(Number(body.customRatePerTola) > 0)) return 'Enter a rate per tola for Other metal items.';
  return null;
}
function metalRateForItem(item: any, metals: any): number {
  const metal = itemMetalType(item);
  if (metal === 'silver') return Number(metals.silverRatePerTola) || 0;
  if (metal === 'other') return Number(item.customRatePerTola) || 0;
  return Number(metals.goldRatePerTola) || 0;
}
function metalDefaultName(category: string): string {
  const metal = itemMetalType({ category });
  if (metal === 'silver') return 'Silver';
  if (metal === 'other') return 'Other';
  return 'Gold';
}
function calcItemLinePriceServer(item: any, { weightUnit = 'grams', tolaParts = null as any, metals }: any): number {
  const metal = itemMetalType(item);
  const making = Number(item.makingCharge) || 0;
  const weightGrams = Number(item.weightGrams) || 0;
  const rate = metalRateForItem(item, metals);
  if (metal === 'other' && !rate) { const sale = Number(item.salePrice); if (sale > 0) return Math.round(sale); return Math.round(making); }
  const karatFactor = metal === 'gold' ? (Number(item.karat) || 24) / 24 : 1;
  let metalValue = 0;
  if (weightUnit === 'tola' && tolaParts) {
    const t = Number(tolaParts.tola) || 0, a = Number(tolaParts.aana) || 0, l = Number(tolaParts.laal) || 0;
    if (!t && !a && !l) return 0;
    if (!rate) return 0;
    const rateAana = rate / AANA_PER_TOLA, rateLaal = rate / LAAL_PER_TOLA;
    metalValue = (t * rate + a * rateAana + l * rateLaal) * karatFactor;
  } else {
    if (!weightGrams) return 0;
    return itemValue(item, metals);
  }
  const jarti = calcJartiAmountServer({
    jartiRateType: item.jartiRateType,
    jartiRateValue: item.jartiRateValue,
    weightGrams,
    metalValue,
    ratePerTola: rate,
    karatFactor
  });
  return Math.round(metalValue + making + jarti);
}
function buildOrderLine(item: any, quantity: number, metals: any): any {
  const qty = Math.max(1, Number(quantity));
  const unitPrice = itemValue(item, metals);
  const jartiWeightGrams = resolveJartiWeightGramsServer(
    Number(item.weightGrams) || 0,
    item.jartiRateType || 'percent',
    Number(item.jartiRateValue) || 0
  );
  return {
    itemId: item.id, itemName: item.name, sku: item.sku, category: item.category || 'gold',
    quantity: qty, unitPrice, lineTotal: unitPrice * qty,
    weightGrams: Number(item.weightGrams) || 0, karat: Number(item.karat) || 24,
    jartiRateType: item.jartiRateType || 'flat', jartiRateValue: Number(item.jartiRateValue) || 0,
    jartiWeightGrams
  };
}
function buildCustomOrderLine(body: any, quantity: number, metals: any): any {
  const custom = body.customItem || {};
  const category = String(custom.category || body.customCategory || body.category || 'gold').trim().toLowerCase();
  const metal = itemMetalType({ category });
  const itemName = String(custom.name || body.customItemName || '').trim();
  if (metal === 'other' && !itemName) throw new Error('Enter a name for Other metal items.');
  const weightGrams = Number(custom.weightGrams ?? body.customWeightGrams) || 0;
  const karat = Number(custom.karat ?? body.customKarat) || 24;
  const makingCharge = Number(custom.makingCharge ?? body.customMakingCharge) || 0;
  const customRatePerTola = Number(custom.customRatePerTola ?? body.customRatePerTola) || 0;
  const jartiRateType = String(custom.jartiRateType ?? body.customJartiRateType ?? 'percent');
  let jartiRateValue = Number(custom.jartiRateValue ?? body.customJartiRateValue) || 0;
  let jartiWeightGrams = Number(custom.jartiWeightGrams) || 0;
  if (!jartiWeightGrams && jartiRateType !== 'percent') {
    const jt = Number(custom.jartiTola ?? body.customJartiTola) || 0;
    const ja = Number(custom.jartiAana ?? body.customJartiAana) || 0;
    const jl = Number(custom.jartiLaal ?? body.customJartiLaal) || 0;
    if (jt || ja || jl) {
      const totalLaal = jt * LAAL_PER_TOLA + ja * LAAL_PER_AANA + jl;
      jartiWeightGrams = (totalLaal * TOLA_GRAMS) / LAAL_PER_TOLA;
    } else {
      jartiWeightGrams = Number(custom.jartiGrams ?? body.customJartiGrams) || jartiRateValue;
    }
  }
  if (!jartiWeightGrams) jartiWeightGrams = resolveJartiWeightGramsServer(weightGrams, jartiRateType, jartiRateValue);
  if (jartiRateType !== 'percent' && jartiWeightGrams > 0) jartiRateValue = jartiWeightGrams;
  const weightUnit = String(custom.weightUnit || body.customWeightUnit || 'grams');
  const tolaParts = weightUnit === 'tola' ? { tola: Number(custom.weightTola ?? body.customWeightTola) || 0, aana: Number(custom.weightAana ?? body.customWeightAana) || 0, laal: Number(custom.weightLaal ?? body.customWeightLaal) || 0 } : null;
  const hasTolaWeight = weightUnit === 'tola' && tolaParts && (tolaParts.tola || tolaParts.aana || tolaParts.laal);
  if (weightUnit === 'tola') { if (!hasTolaWeight) throw new Error('Weight is required.'); }
  else if (weightGrams <= 0) throw new Error('Weight is required.');
  if (metal === 'other' && !customRatePerTola) throw new Error('Enter a rate per tola for Other metal items.');
  const qty = Math.max(1, Number(quantity));
  const draft = { category, karat, weightGrams, makingCharge, customRatePerTola, salePrice: 0, jartiRateType, jartiRateValue };
  const unitPrice = calcItemLinePriceServer(draft, { weightUnit, tolaParts, metals });
  return {
    itemId: `custom-${Date.now()}`, itemName: itemName || metalDefaultName(category), sku: 'CUSTOM',
    category, quantity: qty, unitPrice, lineTotal: unitPrice * qty, custom: true,
    weightGrams, karat, customRatePerTola: metal === 'other' ? customRatePerTola : 0,
    jartiRateType, jartiRateValue, jartiWeightGrams
  };
}
function nextOrderNumber(store: any): string {
  const nums = (store.orders || []).map((o: any) => Number(String(o.orderNumber || '').replace(/\D/g, ''))).filter((n: number) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 1000) + 1;
  return `SP-${next}`;
}
function applyOrderCompletion(store: any, order: any) {
  for (const line of order.lines) {
    const item = store.items.find((i: any) => i.id === line.itemId);
    if (!item) continue;
    if (item.quantity < line.quantity) throw new Error(`Not enough stock for ${item.name}.`);
    item.quantity -= line.quantity;
    if (item.quantity === 0) item.status = 'sold_out';
    item.updatedAt = new Date().toISOString();
    store.transactions.unshift({ id: newId('tx'), type: 'sale', itemId: item.id, itemName: item.name, quantity: line.quantity, amount: line.lineTotal, note: `Order ${order.orderNumber} — ${order.customerName}`, createdAt: new Date().toISOString() });
  }
}
function revertOrderCompletion(store: any, order: any) {
  const orderRef = `Order ${order.orderNumber}`;
  for (const line of order.lines) {
    const item = store.items.find((i: any) => i.id === line.itemId);
    if (!item) continue;
    item.quantity += line.quantity;
    if (item.quantity > 0) item.status = 'in_stock';
    item.updatedAt = new Date().toISOString();
  }
  store.transactions = store.transactions.filter((tx: any) => !(tx.type === 'sale' && String(tx.note || '').includes(orderRef)));
}
function txAmount(store: any, tx: any): number {
  if (tx.amount != null && Number.isFinite(Number(tx.amount))) return Number(tx.amount);
  const item = store.items.find((i: any) => i.id === tx.itemId);
  if (!item) return 0;
  return itemValue(item, store.settings) * Number(tx.quantity || 0);
}
function inDateRange(iso: string, start: string | null, end: string | null): boolean {
  const day = String(iso || '').slice(0, 10);
  if (!day) return false;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}
async function buildReports(store: any, start: string | null, end: string | null): Promise<any> {
  const metals = await resolveMetalRates(store);
  const inStock = store.items.filter((i: any) => i.status === 'in_stock' && i.quantity > 0);
  const totalWeight = inStock.reduce((sum: number, i: any) => sum + i.weightGrams * i.quantity, 0);
  const totalValue = inStock.reduce((sum: number, i: any) => sum + itemValue(i, metals) * i.quantity, 0);
  const lowStock = store.items.filter((i: any) => i.status === 'in_stock' && i.quantity <= 1);
  const transactions = store.transactions.filter((tx: any) => inDateRange(tx.createdAt, start, end)).map((tx: any) => ({ ...tx, amount: txAmount(store, tx) })).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  const orders = (store.orders || []).filter((o: any) => inDateRange(o.createdAt, start, end)).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  const saleTx = transactions.filter((tx: any) => tx.type === 'sale' && !String(tx.note || '').includes('[VOIDED]'));
  const salesRevenue = saleTx.reduce((sum: number, tx: any) => sum + tx.amount, 0);
  const completedOrders = orders.filter((o: any) => o.status === 'completed');
  const orderRevenue = completedOrders.reduce((sum: number, o: any) => sum + Number(o.totalAmount || 0), 0);
  const pendingOrders = orders.filter((o: any) => ['pending', 'confirmed', 'progress', 'ready'].includes(o.status)).length;
  const salesByDay = saleTx.reduce((acc: any, tx: any) => { const day = tx.createdAt.slice(0, 10); acc[day] = (acc[day] || 0) + tx.amount; return acc; }, {});
  const customerOrderTotals: Record<string, any> = orders.reduce((acc: any, order: any) => {
    const key = order.customerName || 'Unknown';
    if (!acc[key]) acc[key] = { name: key, phone: order.customerPhone || '', orders: 0, total: 0 };
    acc[key].orders += 1;
    if (order.status === 'completed') acc[key].total += Number(order.totalAmount || 0);
    return acc;
  }, {});
  const topCustomers = Object.values(customerOrderTotals).sort((a: any, b: any) => b.total - a.total).slice(0, 10);
  return {
    period: { start: start || null, end: end || null },
    goldRatePerTola: metals.goldRatePerTola,
    goldRatePerTolaNpr: metals.goldRatePerTola,
    metalRatesLive: metals.live, metalCurrency: metals.currency, currency: store.settings.currency || 'NPR',
    sales: { revenue: salesRevenue, salesCount: saleTx.length, orderRevenue, completedOrders: completedOrders.length, pendingOrders, totalOrders: orders.length, salesByDay: Object.entries(salesByDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })), transactions: saleTx },
    inventory: { totalItems: inStock.reduce((sum: number, i: any) => sum + i.quantity, 0), uniqueSkus: inStock.length, totalWeightGrams: Number(totalWeight.toFixed(2)), totalWeightTola: gramsToTola(totalWeight), totalInventoryValue: totalValue, lowStockCount: lowStock.length, lowStock, categoryCounts: inStock.reduce((acc: any, i: any) => { acc[i.category] = (acc[i.category] || 0) + i.quantity; return acc; }, {}), movements: transactions },
    customers: { totalCustomers: topCustomers.length, activeBuyers: topCustomers.filter((c: any) => c.total > 0).length, topCustomers, recentOrders: orders.slice(0, 10) }
  };
}

router.get('/health', asyncRoute(async (_req, res) => {
  const database = await checkSupabaseConnection();
  const metalRates: any = { configured: isMetalApiConfigured(), provider: getProvider() };
  if (metalRates.configured) {
    try { const live = await getLiveMetalRates('USD'); metalRates.ok = true; metalRates.source = live.source; metalRates.updatedAt = live.updatedAt; }
    catch (err: any) { metalRates.ok = false; metalRates.error = err.message; }
  } else { metalRates.ok = false; metalRates.error = 'METAL_PRICE_PROVIDER not configured'; }
  res.json({ ok: (database.ok || !database.valid) && metalRates.ok !== false, dataSource: dataSourceLabel(), database, metalRates });
}));

router.get('/cron/capture-gold-rate', asyncRoute(async (req: any, res) => {
  if (!req.isCron) return res.status(401).json({ error: 'Cron secret required.' });
  const result = await captureSharedGoldRateIfChanged({ currency: req.query.currency });
  res.json(result);
}));

router.get('/metal-rates', asyncRoute(async (req: any, res) => {
  if (!isMetalApiConfigured()) return res.status(503).json({ error: 'Live metal API is not configured.' });
  try {
    const currency = normalizeMetalCurrency(String(req.query.currency || 'USD'));
    const rates = await getLiveMetalRates(currency);
    const tolaNpr = displayToNpr(rates.gold.perTola, currency);
    const gramNpr = displayToNpr(rates.gold.perGram, currency) || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
    if (tolaNpr > 0) appendSharedHistory({ goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr, priceMode: 'api', localDate: localDateStr() }).catch((err: any) => console.warn('metal-rates history save:', err.message));
    res.json(rates);
  } catch (err: any) { res.status(502).json({ error: err.message || 'Could not fetch live metal rates.' }); }
}));

router.get('/shared/gold-rates', asyncRoute(async (req: any, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const priceMode = req.query.priceMode === 'api' ? 'api' : 'manual';
  const data = await getSharedRatesForClient({ date, priceMode });
  res.json(data);
}));

router.post('/shared/gold-rates/ticks', asyncRoute(async (req: any, res) => {
  const ticks = Array.isArray(req.body.ticks) ? req.body.ticks : [];
  const result = await appendSharedTicks(ticks);
  res.json({ ok: true, count: result.count });
}));

router.get('/reports', asyncRoute(async (req: any, res) => {
  const start = req.query.start ? String(req.query.start).slice(0, 10) : null;
  const end = req.query.end ? String(req.query.end).slice(0, 10) : null;
  const store = await readStore(req.userId);
  res.json(await buildReports(store, start, end));
}));

router.get('/settings', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const settings = normalizeSilverRates({ ...store.settings });
  if (settings.goldRatePerTola > 0 && settings.priceMode !== 'api') {
    await appendSharedHistory({ goldRatePerTola: settings.goldRatePerTola, goldRatePerGram: settings.goldRatePerGram, priceMode: 'manual' });
  }
  const shared = await readSharedRates();
  res.json({ ...settings, country: settings.country ?? null, salesTaxRate: Number(settings.salesTaxRate) || 0, locations: getStoreLocations(store), itemCategories: getStoreItemCategories(store), goldRatePerGram: Number((settings.goldRatePerTola / TOLA_GRAMS).toFixed(2)), goldBuyRatePerGram: Number((settings.goldBuyRatePerTola / TOLA_GRAMS).toFixed(2)), rateHistory: shared.history || [] });
}));

router.post('/settings/daily-gold-rate', asyncRoute(async (req: any, res) => {
  const tola = Number(req.body.goldRatePerTola);
  const gram = Number(req.body.goldRatePerGram) || Number((tola / TOLA_GRAMS).toFixed(2));
  const priceMode = req.body.priceMode === 'api' ? 'api' : 'manual';
  if (!Number.isFinite(tola) || tola < 0) return res.status(400).json({ error: 'Gold rate must be a valid number.' });
  const result = await appendSharedHistory({ goldRatePerTola: tola, goldRatePerGram: gram, priceMode, localDate: req.body.localDate });
  const shared = await readSharedRates();
  res.json({ changed: result.changed, rateHistory: shared.history || [] });
}));

router.delete('/settings/rate-history', asyncRoute(async (req: any, res) => {
  const priceMode = req.query.priceMode === 'api' ? 'api' : 'manual';
  const result = await clearSharedRates(priceMode);
  res.json({ rateHistory: result.history });
}));

router.get('/settings/shop-name-available', asyncRoute(async (req: any, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.json({ available: false });
  const taken = await isShopNameTaken(name, req.userId);
  res.json({ available: !taken });
}));

router.patch('/settings', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const now = new Date().toISOString();
  if (req.body.goldRatePerTola != null) {
    const newRate = Number(req.body.goldRatePerTola);
    if (!Number.isFinite(newRate) || newRate < 0) return res.status(400).json({ error: 'Gold rate must be a valid number.' });
    store.settings.goldRatePerTola = newRate;
    await appendSharedHistory({ goldRatePerTola: newRate, goldRatePerGram: Number((newRate / TOLA_GRAMS).toFixed(2)), priceMode: 'manual' });
  }
  if (req.body.goldBuyRatePerTola != null) {
    const buyRate = Number(req.body.goldBuyRatePerTola);
    if (!Number.isFinite(buyRate) || buyRate < 0) return res.status(400).json({ error: 'Gold buy rate must be a valid number.' });
    store.settings.goldBuyRatePerTola = buyRate; store.settings.goldBuyRatePerGram = Number((buyRate / TOLA_GRAMS).toFixed(2));
  } else if (req.body.goldBuyRatePerGram != null) {
    const perGram = Number(req.body.goldBuyRatePerGram) || 0;
    store.settings.goldBuyRatePerGram = perGram; store.settings.goldBuyRatePerTola = Number((perGram * TOLA_GRAMS).toFixed(2));
  }
  if (req.body.shopName != null) {
    const name = String(req.body.shopName).trim();
    if (!name) return res.status(400).json({ error: 'Shop name is required.' });
    if (normalizeShopName(name) !== normalizeShopName(store.settings.shopName)) {
      if (await isShopNameTaken(name, req.userId)) return res.status(409).json({ error: 'This store name is already taken. Please choose another name.' });
    }
    store.settings.shopName = name;
  }
  if (req.body.shopAddress != null) store.settings.shopAddress = String(req.body.shopAddress).trim();
  if (req.body.shopPhone != null) store.settings.shopPhone = String(req.body.shopPhone).trim();
  if (req.body.shopPan != null) store.settings.shopPan = String(req.body.shopPan).trim();
  if (req.body.vatRate != null) {
    const rate = Number(req.body.vatRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return res.status(400).json({ error: 'VAT rate must be between 0 and 100.' });
    store.settings.vatRate = rate;
  }
  // Shop location (country): NP keeps the Nepali defaults, US/CA switch the
  // app to sales-tax mode. salesTaxRate is the % pre-filled at checkout there.
  if (req.body.country != null) {
    const code = String(req.body.country).toUpperCase();
    if (!['NP', 'US', 'CA'].includes(code)) return res.status(400).json({ error: 'Shop location must be NP, US or CA.' });
    store.settings.country = code;
  }
  if (req.body.salesTaxRate != null) {
    const rate = Number(req.body.salesTaxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return res.status(400).json({ error: 'Sales tax rate must be between 0 and 100.' });
    store.settings.salesTaxRate = rate;
  }
  if (req.body.calendarMode != null) {
    const allowed = ['both', 'bs', 'ad'];
    const mode = String(req.body.calendarMode).toLowerCase();
    if (allowed.includes(mode)) store.settings.calendarMode = mode;
  }
  store.settings.priceMode = 'manual'; // live/API pricing removed
  if (req.body.fxRates != null) {
    const fx = req.body.fxRates || {};
    const updated: Record<string, number> = { ...(store.settings.fxRates || DEFAULT_FX_RATES) };
    for (const code of ['USD', 'CAD']) {
      if (fx[code] != null) {
        const v = Number(fx[code]);
        if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ error: `FX rate for ${code} must be a positive number (NPR per 1 ${code}).` });
        updated[code] = v;
      }
    }
    store.settings.fxRates = updated;
    store.settings.fxUpdatedAt = now;
  }
  if (req.body.silverRatePerTola != null) store.settings.silverRatePerTola = Number(req.body.silverRatePerTola) || 0;
  else if (req.body.silverRatePerGram != null) { const perGram = Number(req.body.silverRatePerGram) || 0; store.settings.silverRatePerGram = perGram; store.settings.silverRatePerTola = Number((perGram * TOLA_GRAMS).toFixed(2)); }
  if (req.body.currency != null) { const allowed = ['USD', 'CAD', 'NPR']; const code = String(req.body.currency).toUpperCase(); if (allowed.includes(code)) store.settings.currency = code; }
  if (req.body.locations != null) { if (!Array.isArray(req.body.locations)) return res.status(400).json({ error: 'Locations must be an array.' }); store.settings.locations = [...new Set(req.body.locations.map((l: any) => String(l).trim()).filter(Boolean))]; }
  if (req.body.itemCategories != null) { if (!Array.isArray(req.body.itemCategories)) return res.status(400).json({ error: 'Item categories must be an array.' }); store.settings.itemCategories = normalizeItemCategories(req.body.itemCategories); }
  store.settings.updatedAt = now;
  store.settings.goldRatePerGram = Number((store.settings.goldRatePerTola / TOLA_GRAMS).toFixed(2));
  store.settings.goldBuyRatePerGram = Number((store.settings.goldBuyRatePerTola / TOLA_GRAMS).toFixed(2));
  normalizeSilverRates(store.settings);
  await writeStore(store, req.userId);
  const shared = await readSharedRates();
  res.json({ ...store.settings, locations: getStoreLocations(store), itemCategories: getStoreItemCategories(store), goldBuyRatePerGram: Number((store.settings.goldBuyRatePerTola / TOLA_GRAMS).toFixed(2)), rateHistory: shared.history || [] });
}));

// Sequential unique item number: ITM-0001, ITM-0002, …
function nextItemNumber(store: any): string {
  const n = (Number(store.settings?.itemCounter) || 0) + 1;
  if (!store.settings) store.settings = {};
  store.settings.itemCounter = n;
  return `ITM-${String(n).padStart(4, '0')}`;
}

router.get('/items', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  // One-time backfill: number existing items oldest-first.
  let changed = false;
  for (let i = store.items.length - 1; i >= 0; i--) {
    if (!store.items[i].itemNumber) { store.items[i].itemNumber = nextItemNumber(store); changed = true; }
  }
  if (changed) await writeStore(store, req.userId);
  const { q, category, status } = req.query;
  let items = [...store.items];
  if (q) { const term = String(q).toLowerCase(); items = items.filter((i: any) => i.name.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term) || (i.itemNumber || '').toLowerCase().includes(term) || (i.location || '').toLowerCase().includes(term) || (i.notes || '').toLowerCase().includes(term)); }
  if (category) items = items.filter((i: any) => i.category === category);
  if (status) items = items.filter((i: any) => i.status === status);
  items.sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt));
  const metals = await resolveMetalRates(store);
  res.json({ items, goldRatePerTola: metals.goldRatePerTola, silverRatePerTola: metals.silverRatePerTola, metalRatesLive: metals.live, metalCurrency: metals.currency, metalRatesError: metals.liveError || null });
}));

router.get('/items/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const item = store.items.find((i: any) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json(item);
}));

router.post('/items', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const body = req.body || {};
  if (!body.name || !body.sku) return res.status(400).json({ error: 'Name and SKU are required.' });
  const metalError = validateInventoryMetalFields(body);
  if (metalError) return res.status(400).json({ error: metalError });
  if (store.items.some((i: any) => i.sku === body.sku)) return res.status(400).json({ error: 'SKU already exists.' });
  const now = new Date().toISOString();
  const item = normalizeItemRecord({ id: newId('sp'), sku: String(body.sku).trim(), name: String(body.name).trim(), category: body.category || 'gold', karat: Number(body.karat) || 24, weightGrams: Number(body.weightGrams) || 0, makingCharge: Number(body.makingCharge) || 0, jartiRateType: String(body.jartiRateType || 'flat'), jartiRateValue: Number(body.jartiRateValue) || 0, hallmarkNumber: String(body.hallmarkNumber || '').trim(), hallmarkDate: String(body.hallmarkDate || '').trim(), purchaseCost: Number(body.purchaseCost) || 0, salePrice: Number(body.salePrice) || 0, customRatePerTola: Number(body.customRatePerTola) || 0, quantity: Math.max(0, Number(body.quantity) || 0), status: body.status || 'in_stock', location: String(body.location || '').trim(), hallmark: Boolean(body.hallmark), notes: String(body.notes || '').trim(), hsCode: String(body.hsCode || '').trim(), stoneAmount: Math.max(0, Math.round(Number(body.stoneAmount) || 0)), createdAt: now, updatedAt: now }, { isNew: true });
  (item as any).itemNumber = nextItemNumber(store);
  store.items.unshift(item);
  await writeStore(store, req.userId);
  res.status(201).json(item);
}));

router.put('/items/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const idx = store.items.findIndex((i: any) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found.' });
  const existing = store.items[idx];
  if (isItemSoldOut(existing)) return res.status(400).json({ error: 'Sold out items cannot be edited.' });
  const body = req.body || {};
  if (body.sku && body.sku !== existing.sku && store.items.some((i: any) => i.sku === body.sku)) return res.status(400).json({ error: 'SKU already exists.' });
  const name = body.name != null ? String(body.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const metalError = validateInventoryMetalFields({ category: body.category != null ? body.category : existing.category, customRatePerTola: body.customRatePerTola != null ? body.customRatePerTola : existing.customRatePerTola });
  if (metalError) return res.status(400).json({ error: metalError });
  const updated = normalizeItemRecord({ id: existing.id, sku: body.sku != null ? String(body.sku).trim() : existing.sku, name, category: body.category != null ? body.category : existing.category, karat: body.karat != null ? Number(body.karat) || existing.karat : existing.karat, weightGrams: body.weightGrams != null ? Number(body.weightGrams) || 0 : existing.weightGrams, makingCharge: body.makingCharge != null ? Number(body.makingCharge) || 0 : existing.makingCharge, jartiRateType: body.jartiRateType != null ? String(body.jartiRateType) : existing.jartiRateType || 'flat', jartiRateValue: body.jartiRateValue != null ? Number(body.jartiRateValue) || 0 : existing.jartiRateValue || 0, hallmarkNumber: body.hallmarkNumber != null ? String(body.hallmarkNumber).trim() : existing.hallmarkNumber || '', hallmarkDate: body.hallmarkDate != null ? String(body.hallmarkDate).trim() : existing.hallmarkDate || '', purchaseCost: body.purchaseCost != null ? Number(body.purchaseCost) || 0 : existing.purchaseCost, salePrice: body.salePrice != null ? Number(body.salePrice) || 0 : existing.salePrice || 0, customRatePerTola: body.customRatePerTola != null ? Number(body.customRatePerTola) || 0 : existing.customRatePerTola || 0, quantity: body.quantity != null ? Number(body.quantity) || 0 : existing.quantity, status: body.status != null ? body.status : existing.status, location: body.location != null ? String(body.location).trim() : existing.location || '', hallmark: body.hallmark != null ? Boolean(body.hallmark) : existing.hallmark, notes: body.notes != null ? String(body.notes).trim() : existing.notes || '', hsCode: body.hsCode != null ? String(body.hsCode).trim() : existing.hsCode || '', stoneAmount: body.stoneAmount != null ? Math.max(0, Math.round(Number(body.stoneAmount) || 0)) : existing.stoneAmount || 0, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
  (updated as any).itemNumber = existing.itemNumber || '';
  store.items[idx] = updated;
  await writeStore(store, req.userId);
  res.json(updated);
}));

router.delete('/items/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const before = store.items.length;
  store.items = store.items.filter((i: any) => i.id !== req.params.id);
  if (store.items.length === before) return res.status(404).json({ error: 'Item not found.' });
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

router.get('/customers', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const changed = syncCustomersFromOrders(store);
  if (changed) await writeStore(store, req.userId);
  res.json({ customers: listCustomersWithActivity(store) });
}));

router.post('/customers', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Customer name is required.' });
  const phone = String(req.body.phone || '').trim();
  const phoneError = validateCustomerPhone(phone, req.body.phoneRegion);
  if (phoneError) return res.status(400).json({ error: phoneError });
  const customer = upsertCustomerInStore(store, req.body);
  await writeStore(store, req.userId);
  const purchaseCounts = computeCustomerPurchaseCounts(store);
  res.status(201).json({ customer: { ...customer, purchases: purchaseCounts.get(customerMatchKey(customer.name, customer.phone)) || 0 }, customers: listCustomersWithActivity(store) });
}));

router.post('/customers/upsert', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const phone = String(req.body.phone || '').trim();
  const phoneError = validateCustomerPhone(phone, req.body.phoneRegion);
  if (phoneError) return res.status(400).json({ error: phoneError });
  const customer = upsertCustomerInStore(store, req.body);
  if (!customer) return res.status(400).json({ error: 'Customer name is required.' });
  await writeStore(store, req.userId);
  res.json({ customer, customers: listCustomersWithActivity(store) });
}));

router.delete('/customers/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const before = (store.customers || []).length;
  store.customers = (store.customers || []).filter((c: any) => c.id !== req.params.id);
  if (store.customers.length === before) return res.status(404).json({ error: 'Customer not found.' });
  await writeStore(store, req.userId);
  res.json({ customers: listCustomersWithActivity(store) });
}));

router.get('/transactions', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const txs = [...store.transactions].sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  res.json({ transactions: txs });
}));

router.post('/transactions', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const body = req.body || {};
  const { type, quantity, note } = body;
  if (body.customItem) {
    const itemName = String(body.itemName || '').trim();
    const qty = Math.max(1, Number(quantity) || 1);
    const amount = Number(body.amount);
    if (!itemName) return res.status(400).json({ error: 'Item name is required for custom sales.' });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'A valid amount is required for custom sales.' });
    const tx = { id: newId('tx'), type: 'sale', itemId: null, itemName, quantity: qty, amount, note: String(note || '').trim(), createdAt: new Date().toISOString() };
    store.transactions.unshift(tx);
    await writeStore(store, req.userId);
    return res.status(201).json({ transaction: tx });
  }
  const { itemId } = body;
  if (!type || !itemId || !quantity) return res.status(400).json({ error: 'Type, item, and quantity are required.' });
  const item = store.items.find((i: any) => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const qty = Math.max(1, Number(quantity));
  if (type === 'stock_in') { item.quantity += qty; item.status = 'in_stock'; }
  else if (type === 'sale' || type === 'stock_out') { if (item.quantity < qty) return res.status(400).json({ error: 'Not enough stock.' }); item.quantity -= qty; if (item.quantity === 0) item.status = 'sold_out'; }
  else return res.status(400).json({ error: 'Invalid transaction type.' });
  item.updatedAt = new Date().toISOString();
  const metals = await resolveMetalRates(store);
  const amount = type === 'sale' ? itemValue(item, metals) * qty : 0;
  const tx = { id: newId('tx'), type, itemId: item.id, itemName: item.name, quantity: qty, amount, note: String(note || '').trim(), createdAt: new Date().toISOString() };
  store.transactions.unshift(tx);
  await writeStore(store, req.userId);
  res.status(201).json({ transaction: tx, item });
}));

router.get('/orders', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  let orders = [...(store.orders || [])];
  const { status } = req.query;
  if (status) orders = orders.filter((o: any) => o.status === status);
  orders.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  const metals = await resolveMetalRates(store);
  res.json({ orders, goldRatePerTola: metals.goldRatePerTola, metalRatesLive: metals.live, metalCurrency: metals.currency });
}));

router.get('/orders/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const order = (store.orders || []).find((o: any) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
}));

router.post('/orders', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.orders)) store.orders = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const quantity = Math.max(1, Number(body.quantity) || 1);
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  const metals = await resolveMetalRates(store);
  const now = new Date().toISOString();
  let line: any;
  if (body.orderItemMode === 'custom' || body.customItem) {
    try { line = buildCustomOrderLine(body, quantity, metals); } catch (err: any) { return res.status(400).json({ error: err.message }); }
  } else {
    const itemId = String(body.itemId || '').trim();
    if (!itemId) return res.status(400).json({ error: 'Item is required.' });
    const item = store.items.find((i: any) => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (item.quantity < quantity) return res.status(400).json({ error: 'Not enough stock for this order.' });
    line = buildOrderLine(item, quantity, metals);
  }
  const hasAdvance = body.advanceAmount !== '' && body.advanceAmount != null;
  const hasCustomerGold = body.customerGoldGrams !== '' && body.customerGoldGrams != null;
  const hasGoldAdded = body.goldAddedGrams !== '' && body.goldAddedGrams != null;
  const hasRemaining = body.remainingPayment !== '' && body.remainingPayment != null;
  const advanceAmount = hasAdvance ? Number(body.advanceAmount) || 0 : 0;
  const customerGoldGrams = hasCustomerGold ? Number(body.customerGoldGrams) || 0 : 0;
  const goldAddedGrams = hasGoldAdded ? Number(body.goldAddedGrams) || 0 : 0;
  const hasPaymentInfo = hasAdvance || Boolean(body.advancePaid) || hasCustomerGold || hasGoldAdded || hasRemaining;
  let remainingPayment = null;
  if (hasRemaining) {
    remainingPayment = Number(body.remainingPayment);
    if (!Number.isFinite(remainingPayment)) remainingPayment = Math.max(0, line.lineTotal - advanceAmount);
  } else if (hasPaymentInfo) {
    remainingPayment = Math.max(0, line.lineTotal - advanceAmount);
  }
  const order = {
    id: newId('ord'), orderNumber: nextOrderNumber(store), customerName,
    customerPhone: String(body.customerPhone || '').trim(), status: 'pending', lines: [line],
    totalAmount: line.lineTotal, note: String(body.note || '').trim(),
    karigarId: String(body.karigarId || '').trim() || null,
    karigarName: String(body.karigarName || '').trim(),
    advanceAmount, advancePaid: Boolean(body.advancePaid),
    customerGoldGrams, goldAddedGrams, remainingPayment,
    createdAt: now, updatedAt: now
  };
  upsertCustomerInStore(store, { name: customerName, phone: order.customerPhone });
  store.orders.unshift(order);
  await writeStore(store, req.userId);
  res.status(201).json(order);
}));

router.patch('/orders/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const idx = (store.orders || []).findIndex((o: any) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found.' });
  const order = store.orders[idx];
  const body = req.body || {};
  const allowed = ['pending', 'confirmed', 'progress', 'ready', 'completed', 'cancelled'];
  const nextStatus = body.status || order.status;
  if (!allowed.includes(nextStatus)) return res.status(400).json({ error: 'Invalid order status.' });
  if (nextStatus === 'completed' && order.status !== 'completed') {
    try { applyOrderCompletion(store, order); } catch (err: any) { return res.status(400).json({ error: err.message }); }
  } else if (nextStatus !== 'completed' && order.status === 'completed') {
    revertOrderCompletion(store, order);
  }
  if (body.customerName != null) order.customerName = String(body.customerName).trim();
  if (body.customerPhone != null) order.customerPhone = String(body.customerPhone).trim();
  if (body.note != null) order.note = String(body.note).trim();
  if (body.karigarId !== undefined) order.karigarId = String(body.karigarId || '').trim() || null;
  if (body.karigarName != null) order.karigarName = String(body.karigarName).trim();
  if (body.advanceAmount != null) order.advanceAmount = body.advanceAmount === '' ? 0 : Number(body.advanceAmount) || 0;
  if (body.advancePaid != null) order.advancePaid = Boolean(body.advancePaid);
  if (body.customerGoldGrams != null) order.customerGoldGrams = body.customerGoldGrams === '' ? 0 : Number(body.customerGoldGrams) || 0;
  if (body.goldAddedGrams != null) order.goldAddedGrams = body.goldAddedGrams === '' ? 0 : Number(body.goldAddedGrams) || 0;
  if (body.remainingPayment != null) {
    if (body.remainingPayment === '') {
      order.remainingPayment = Math.max(0, (Number(order.totalAmount) || 0) - (Number(order.advanceAmount) || 0));
    } else {
      const parsed = Number(body.remainingPayment);
      order.remainingPayment = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  order.status = nextStatus; order.updatedAt = new Date().toISOString();
  store.orders[idx] = order;
  await writeStore(store, req.userId);
  res.json(order);
}));

router.delete('/orders/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const order = (store.orders || []).find((o: any) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status === 'completed') revertOrderCompletion(store, order);
  store.orders = store.orders.filter((o: any) => o.id !== req.params.id);
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

// ===== Karigar (craftsman) routes =====
router.get('/karigar', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  res.json({ karigars: store.karigars || [] });
}));

router.post('/karigar', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.karigars)) store.karigars = [];
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Karigar name is required.' });
  const now = new Date().toISOString();
  const karigar = {
    id: newId('kg'), name, phone: String(body.phone || '').trim(),
    specialty: String(body.specialty || '').trim(),
    address: String(body.address || '').trim(),
    notes: String(body.notes || '').trim(),
    goldIssuedGrams: 0, goldReturnedGrams: 0, goldWastageGrams: 0,
    active: body.active == null ? true : Boolean(body.active),
    createdAt: now, updatedAt: now
  };
  store.karigars.unshift(karigar);
  await writeStore(store, req.userId);
  res.status(201).json(karigar);
}));

router.put('/karigar/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.karigars)) store.karigars = [];
  const idx = store.karigars.findIndex((k: any) => k.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Karigar not found.' });
  const body = req.body || {};
  const karigar = store.karigars[idx];
  if (body.name != null) karigar.name = String(body.name).trim();
  if (body.phone != null) karigar.phone = String(body.phone).trim();
  if (body.specialty != null) karigar.specialty = String(body.specialty).trim();
  if (body.address != null) karigar.address = String(body.address).trim();
  if (body.notes != null) karigar.notes = String(body.notes).trim();
  if (body.active != null) karigar.active = Boolean(body.active);
  karigar.updatedAt = new Date().toISOString();
  store.karigars[idx] = karigar;
  await writeStore(store, req.userId);
  res.json(karigar);
}));

router.delete('/karigar/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.karigars)) store.karigars = [];
  const before = store.karigars.length;
  store.karigars = store.karigars.filter((k: any) => k.id !== req.params.id);
  if (store.karigars.length === before) return res.status(404).json({ error: 'Karigar not found.' });
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

router.post('/karigar/:id/issue-gold', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.karigars)) store.karigars = [];
  const karigar = store.karigars.find((k: any) => k.id === req.params.id);
  if (!karigar) return res.status(404).json({ error: 'Karigar not found.' });
  const body = req.body || {};
  const weightGrams = Number(body.weightGrams) || 0;
  if (weightGrams <= 0) return res.status(400).json({ error: 'Weight must be greater than 0.' });
  const now = new Date().toISOString();
  const entry = {
    id: newId('gl'), karigarId: karigar.id, karigarName: karigar.name,
    type: 'issue', weightGrams, karat: Number(body.karat) || 24,
    description: String(body.description || '').trim(),
    date: String(body.date || now.slice(0, 10)), createdAt: now
  };
  karigar.goldIssuedGrams = (karigar.goldIssuedGrams || 0) + weightGrams;
  karigar.updatedAt = now;
  if (!Array.isArray(store.goldLedger)) store.goldLedger = [];
  store.goldLedger.unshift(entry);
  await writeStore(store, req.userId);
  res.status(201).json({ entry, karigar });
}));

router.post('/karigar/:id/return-gold', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.karigars)) store.karigars = [];
  const karigar = store.karigars.find((k: any) => k.id === req.params.id);
  if (!karigar) return res.status(404).json({ error: 'Karigar not found.' });
  const body = req.body || {};
  const weightGrams = Number(body.weightGrams) || 0;
  const wastageGrams = Number(body.wastageGrams) || 0;
  if (weightGrams <= 0) return res.status(400).json({ error: 'Returned weight must be greater than 0.' });
  const now = new Date().toISOString();
  const entry = {
    id: newId('gl'), karigarId: karigar.id, karigarName: karigar.name,
    type: 'return', weightGrams, wastageGrams, karat: Number(body.karat) || 24,
    description: String(body.description || '').trim(),
    date: String(body.date || now.slice(0, 10)), createdAt: now
  };
  karigar.goldReturnedGrams = (karigar.goldReturnedGrams || 0) + weightGrams;
  karigar.goldWastageGrams = (karigar.goldWastageGrams || 0) + wastageGrams;
  karigar.updatedAt = now;
  if (!Array.isArray(store.goldLedger)) store.goldLedger = [];
  store.goldLedger.unshift(entry);
  await writeStore(store, req.userId);
  res.status(201).json({ entry, karigar });
}));

// ===== Gold Ledger =====
router.get('/gold-ledger', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const ledger = [...(store.goldLedger || [])].sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  const karigarId = req.query.karigarId as string | undefined;
  const filtered = karigarId ? ledger.filter((e: any) => e.karigarId === karigarId) : ledger;
  res.json({ entries: filtered });
}));

// ===== Old Gold Exchange (buy-back) =====
router.get('/old-gold', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const exchanges = [...(store.oldGoldExchanges || [])].sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  res.json({ exchanges });
}));

router.post('/old-gold', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.oldGoldExchanges)) store.oldGoldExchanges = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const weightGrams = Number(body.weightGrams) || 0;
  const karat = Number(body.karat) || 22;
  const ratePerTola = Number(body.ratePerTola) || 0;
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  if (weightGrams <= 0) return res.status(400).json({ error: 'Weight must be greater than 0.' });
  const tola = weightGrams / TOLA_GRAMS;
  const purityFactor = karat / 24;
  const buyValue = Math.round(tola * ratePerTola * purityFactor);
  const now = new Date().toISOString();
  const exchange = {
    id: newId('og'), customerName, customerPhone: String(body.customerPhone || '').trim(),
    weightGrams, karat, ratePerTola, buyValue,
    description: String(body.description || '').trim(),
    date: String(body.date || now.slice(0, 10)), createdAt: now
  };
  store.oldGoldExchanges.unshift(exchange);
  upsertCustomerInStore(store, { name: customerName, phone: exchange.customerPhone });
  await writeStore(store, req.userId);
  res.status(201).json(exchange);
}));

router.delete('/old-gold/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.oldGoldExchanges)) store.oldGoldExchanges = [];
  const before = store.oldGoldExchanges.length;
  store.oldGoldExchanges = store.oldGoldExchanges.filter((e: any) => e.id !== req.params.id);
  if (store.oldGoldExchanges.length === before) return res.status(404).json({ error: 'Exchange not found.' });
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

// ===== Sales (immutable invoices with frozen price snapshots) =====

const PAYMENT_METHODS = ['cash', 'esewa', 'khalti', 'card', 'bank', 'credit'];

function nextInvoiceNumber(store: any): string {
  const n = (Number(store.settings.invoiceCounter) || 0) + 1;
  store.settings.invoiceCounter = n;
  return `INV-${String(n).padStart(6, '0')}`;
}

function nextRepairNumber(store: any): string {
  const n = (Number(store.settings.repairCounter) || 0) + 1;
  store.settings.repairCounter = n;
  return `REP-${String(n).padStart(4, '0')}`;
}

function nextSchemeNumber(store: any): string {
  const n = (Number(store.settings.schemeCounter) || 0) + 1;
  store.settings.schemeCounter = n;
  return `GS-${String(n).padStart(4, '0')}`;
}

function oldGoldBuyValue(weightGrams: number, karat: number, ratePerTola: number): number {
  return Math.round((weightGrams / TOLA_GRAMS) * ratePerTola * ((karat || 24) / 24));
}

function schemePaidTotal(scheme: any): number {
  return (scheme.installments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
}

/** Amount still owed on a sale: the original due minus payments received since. */
function saleDueRemaining(sale: any): number {
  const baseDue = Number(sale.payment?.due) || 0;
  const paidSince = (sale.payments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
  return Math.max(0, baseDue - paidSince);
}

function withDueFields(sale: any) {
  const paidSince = (sale.payments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
  return { ...sale, paidSince, dueRemaining: saleDueRemaining(sale) };
}

/**
 * Create a sale (invoice). This is the single atomic checkout path:
 * validates all lines, freezes rates/weights/karat/jarti/FX onto the sale,
 * assigns a gap-free sequential invoice number, deducts stock, applies
 * old-gold trade-in and gold-scheme credits, and writes matching
 * transaction entries. Sales are immutable — corrections go through void.
 */
router.post('/sales', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.sales)) store.sales = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) return res.status(400).json({ error: 'At least one line is required.' });

  const metals = await resolveMetalRates(store);
  const now = new Date().toISOString();

  // 1) Build snapshot lines; validate everything before touching stock.
  const lines: any[] = [];
  for (const raw of rawLines) {
    const qty = Math.max(1, Math.floor(Number(raw.quantity) || 1));
    if (raw.itemId && !raw.custom && !raw.fromOrder) {
      const item = store.items.find((i: any) => i.id === raw.itemId);
      if (!item) return res.status(404).json({ error: `Item not found: ${raw.itemId}` });
      if (isItemSoldOut(item) || item.quantity < qty) return res.status(400).json({ error: `Not enough stock for ${item.name}.` });
      const unitPrice = itemValue(item, metals);
      lines.push({
        inventory: true, itemId: item.id, sku: item.sku, name: item.name,
        category: item.category || 'gold', quantity: qty, unitPrice, lineTotal: unitPrice * qty,
        weightGrams: Number(item.weightGrams) || 0, karat: Number(item.karat) || 24,
        makingCharge: Number(item.makingCharge) || 0,
        jartiRateType: item.jartiRateType || 'flat', jartiRateValue: Number(item.jartiRateValue) || 0,
        ratePerTola: metalRateForItem(item, metals),
        // Guarantee-bill columns (informational; already included in unitPrice)
        hsCode: String(raw.hsCode ?? item.hsCode ?? '').trim(),
        stoneAmount: Math.max(0, Math.round(Number(raw.stoneAmount ?? item.stoneAmount) || 0))
      });
    } else {
      const name = String(raw.name || raw.itemName || '').trim();
      const unitPrice = Number(raw.unitPrice ?? raw.price);
      if (!name) return res.status(400).json({ error: 'Custom line items need a name.' });
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return res.status(400).json({ error: `A valid price is required for ${name}.` });
      lines.push({
        inventory: false, itemId: null, sku: String(raw.sku || 'CUSTOM'), name,
        category: String(raw.category || 'gold'), quantity: qty,
        unitPrice: Math.round(unitPrice), lineTotal: Math.round(unitPrice) * qty,
        weightGrams: Number(raw.weightGrams) || 0, karat: Number(raw.karat) || 0,
        makingCharge: Number(raw.makingCharge) || 0,
        jartiRateType: raw.jartiRateType || null, jartiRateValue: Number(raw.jartiRateValue) || 0,
        ratePerTola: Number(raw.customRatePerTola) || (String(raw.category || 'gold') === 'silver' ? Number(metals.silverRatePerTola) || 0 : Number(metals.goldRatePerTola) || 0),
        fromOrder: raw.fromOrder || null, orderNumber: raw.orderNumber || null,
        notes: String(raw.notes || '').trim(),
        hsCode: String(raw.hsCode || '').trim(),
        stoneAmount: Math.max(0, Math.round(Number(raw.stoneAmount) || 0))
      });
    }
  }

  // 2) Totals (all amounts in NPR; server-side math is authoritative).
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const discount = Math.min(Math.max(0, Math.round(Number(body.discount) || 0)), subtotal);
  const afterDiscount = subtotal - discount;
  // The POS UI sends 'percent' or 'amount'; anything non-percent is a flat NPR amount.
  const taxType = (body.taxType == null || body.taxType === 'percent') ? 'percent' : 'flat';
  const taxValue = Math.max(0, Number(body.taxValue) || 0);
  const taxAmount = taxValue > 0
    ? (taxType === 'percent' ? Math.round((afterDiscount * taxValue) / 100) : Math.round(taxValue))
    : 0;

  // Optional 0.5% Skill Promotion Fee (सिप प्रवर्द्धन शुल्क) charged on the
  // after-discount amount — a real charge included in the invoice total.
  const skillFeeEnabled = Boolean(body.skillFee);
  const skillFeeAmount = skillFeeEnabled ? Math.round(afterDiscount * 0.005) : 0;

  // 3) Old-gold trade-in credit.
  let oldGold: any = null;
  if (body.oldGold && Number(body.oldGold.weightGrams) > 0) {
    const og = body.oldGold;
    const weightGrams = Number(og.weightGrams);
    const karat = Number(og.karat) || 22;
    const ratePerTola = Number(og.ratePerTola) || Number(store.settings.goldBuyRatePerTola) || Number(metals.goldRatePerTola) || 0;
    if (ratePerTola <= 0) return res.status(400).json({ error: 'Old-gold rate per tola is required.' });
    oldGold = { weightGrams, karat, ratePerTola, description: String(og.description || '').trim(), credit: oldGoldBuyValue(weightGrams, karat, ratePerTola) };
  }

  // 4) Gold-scheme redemption credit.
  let scheme: any = null;
  if (body.schemeId) {
    scheme = (store.schemes || []).find((s: any) => s.id === body.schemeId);
    if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });
    if (scheme.status !== 'active' && scheme.status !== 'matured') {
      return res.status(400).json({ error: `Scheme ${scheme.schemeNumber} is ${scheme.status} and cannot be redeemed.` });
    }
    if (schemePaidTotal(scheme) <= 0) return res.status(400).json({ error: 'Scheme has no deposits to redeem.' });
  }
  const schemeCredit = scheme ? schemePaidTotal(scheme) : 0;
  const oldGoldCredit = oldGold ? oldGold.credit : 0;

  const grossTotal = afterDiscount + taxAmount + skillFeeAmount;
  const creditApplied = Math.min(grossTotal, oldGoldCredit + schemeCredit);
  const total = grossTotal - creditApplied;
  const creditOverflow = Math.max(0, oldGoldCredit + schemeCredit - grossTotal);

  // 5) Payment.
  const pay = body.payment || {};
  const method = PAYMENT_METHODS.includes(pay.method) ? pay.method : 'cash';
  let received = 0, change = 0, due = 0;
  if (method === 'credit') {
    // Partial payment now, rest on credit — both amounts saved on the invoice.
    received = pay.received != null && pay.received !== ''
      ? Math.min(Math.max(0, Math.round(Number(pay.received) || 0)), total)
      : 0;
    due = Math.max(0, total - received);
  }
  else if (method === 'cash') {
    received = pay.received != null && pay.received !== '' ? Math.max(0, Number(pay.received) || 0) : total;
    change = Math.max(0, received - total);
    due = Math.max(0, total - received);
  } else { received = total; }

  // 6) All validation passed — apply stock deductions.
  for (const line of lines) {
    if (!line.inventory) continue;
    const item = store.items.find((i: any) => i.id === line.itemId);
    item.quantity -= line.quantity;
    if (item.quantity <= 0) { item.quantity = 0; item.status = 'sold_out'; }
    item.updatedAt = now;
  }

  const invoiceNumber = nextInvoiceNumber(store);
  const saleId = newId('sale');

  // 7) Transaction entries (stock/audit trail), tagged with the invoice number.
  for (const line of lines) {
    store.transactions.unshift({
      id: newId('tx'), type: 'sale', itemId: line.itemId, itemName: line.name,
      quantity: line.quantity, amount: line.lineTotal,
      note: `Sale ${invoiceNumber} — ${customerName}${line.orderNumber ? ` · Order ${line.orderNumber}` : ''}`,
      createdAt: now
    });
  }

  // 8) Old-gold exchange entry linked to this sale.
  if (oldGold) {
    if (!Array.isArray(store.oldGoldExchanges)) store.oldGoldExchanges = [];
    store.oldGoldExchanges.unshift({
      id: newId('og'), customerName, customerPhone: String(body.customerPhone || '').trim(),
      weightGrams: oldGold.weightGrams, karat: oldGold.karat, ratePerTola: oldGold.ratePerTola,
      buyValue: oldGold.credit, description: oldGold.description || `Trade-in on ${invoiceNumber}`,
      saleId, invoiceNumber, date: now.slice(0, 10), createdAt: now
    });
  }

  // 9) Scheme redemption.
  if (scheme) {
    scheme.status = 'redeemed';
    scheme.redeemedAt = now;
    scheme.redeemedAmount = schemeCredit;
    scheme.saleId = saleId;
    scheme.invoiceNumber = invoiceNumber;
    scheme.updatedAt = now;
  }

  // Guarantee-bill extras — display/record fields snapshotted verbatim onto the
  // immutable invoice (they never change the money math; the skill fee above does).
  const be = body.bill || {};
  const bill = {
    buyerIdNo: String(be.buyerIdNo || '').trim(),
    buyerAddress: String(be.buyerAddress || '').trim(),
    orderDate: String(be.orderDate || '').trim(),
    deliveryDate: String(be.deliveryDate || '').trim(),
    kaligadh: String(be.kaligadh || '').trim(),
    oldWeightGrams: Math.max(0, Number(be.oldWeightGrams) || 0),
    addWeightGrams: Math.max(0, Number(be.addWeightGrams) || 0),
    chequeNo: String(be.chequeNo || '').trim(),
    qrRef: String(be.qrRef || '').trim()
  };

  const sale = {
    id: saleId, invoiceNumber, status: 'completed',
    customerName, customerPhone: String(body.customerPhone || '').trim(), customerPan: String(body.customerPan || '').trim(),
    lines: lines.map(({ inventory, ...rest }) => ({ ...rest, inventory })),
    subtotal, discount, afterDiscount, taxType, taxValue, taxAmount,
    skillFee: skillFeeEnabled, skillFeeAmount,
    bill,
    oldGold, oldGoldCredit, schemeId: scheme ? scheme.id : null, schemeNumber: scheme ? scheme.schemeNumber : null, schemeCredit,
    creditApplied, creditOverflow, total,
    payment: { method, received, change, due },
    rateSnapshot: {
      goldRatePerTola: Number(metals.goldRatePerTola) || 0,
      silverRatePerTola: Number(metals.silverRatePerTola) || 0,
      source: metals.live ? `api:${metals.source || 'live'}` : 'manual',
      fxCurrency: metals.fx?.currency || 'NPR',
      fxNprPerUnit: Number(metals.fx?.nprPerUnit) || 1,
      capturedAt: now
    },
    note: String(body.note || '').trim(),
    // Later payments received against a credit/partial-due sale. The invoice
    // itself never changes; these are separate receipt events.
    payments: [] as any[],
    voidedAt: null, voidReason: null,
    createdAt: now
  };
  store.sales.unshift(sale);
  // Credit (udharo): the due amount also becomes a detailed entry in
  // Records → Credit, linked to this invoice.
  if (due > 0) addLinkedCreditRecord(store, sale, now);
  upsertCustomerInStore(store, { name: customerName, phone: sale.customerPhone });
  await writeStore(store, req.userId);
  res.status(201).json(withDueFields(sale));
}));

/**
 * Add a Records → Credit entry for a sale carrying an outstanding due.
 * Carries the COMPLETE checkout information — person, invoice, total, paid,
 * credit amount, date, and every line's details — copied verbatim from the
 * sale so Checkout and Credit records stay connected and consistent.
 */
function addLinkedCreditRecord(store: any, sale: any, now: string) {
  if (!Array.isArray(store.options)) store.options = [];
  const isOpeningDue = sale.type === 'opening_due';
  const lines = Array.isArray(sale.lines) ? sale.lines : [];
  let goldWeight = 0;
  const detailParts = lines.map((l: any) => {
    let p = `${l.name || 'Item'}`;
    if ((Number(l.quantity) || 1) > 1) p += ` ×${l.quantity}`;
    if ((Number(l.weightGrams) || 0) > 0) {
      p += ` · ${l.weightGrams}g`;
      if ((Number(l.karat) || 0) > 0) p += ` ${l.karat}K`;
      goldWeight += (Number(l.weightGrams) || 0) * Math.max(1, Number(l.quantity) || 1);
    }
    return p;
  });
  const phone = String(sale.customerPhone || '').trim();
  const creditFor = isOpeningDue
    ? 'Cash'
    : (lines.map((l: any) => l.name || 'Item').join(', ') || 'Cash');
  store.options.unshift({
    id: newId('opt'), type: 'credit',
    metal: goldWeight > 0 ? 'gold' : 'cash',
    name: sale.customerName || 'Walk-in',
    item: detailParts.join(', ').slice(0, 400),
    creditFor: creditFor.slice(0, 200),
    weightGrams: Math.round(goldWeight * 1000) / 1000, karat: 0, rate: 0,
    cost: Number(sale.payment?.due) || 0,
    date: String(sale.createdAt || now).slice(0, 10),
    committedDate: '',
    notes: `${isOpeningDue ? 'Old due' : 'Credit sale'} ${sale.invoiceNumber}` + (phone ? ` · ${phone}` : ''),
    payments: [] as any[], status: 'open',
    saleId: sale.id, invoiceNumber: sale.invoiceNumber,
    customerPhone: phone,
    saleTotal: Number(sale.total) || 0,
    salePaid: Number(sale.payment?.received) || 0,
    saleLines: lines.map((l: any) => ({
      name: String(l.name || ''), quantity: Number(l.quantity) || 1,
      weightGrams: Number(l.weightGrams) || 0, karat: Number(l.karat) || 0,
      unitPrice: Number(l.unitPrice) || 0, lineTotal: Number(l.lineTotal) || 0,
      category: String(l.category || '')
    })),
    createdAt: now, updatedAt: now
  });
}

/**
 * Record an opening balance / manual due (old udharo from the paper khata).
 * It reuses the sales/dues machinery — appears in the udharo list, takes
 * payments via /sales/:id/payments, counts in outstanding credit — but is
 * typed 'opening_due', numbered in its own DUE- series, and NEVER counted
 * as sales revenue (the money was earned before the app).
 */
router.post('/sales/manual-due', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.sales)) store.sales = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const amount = Math.round(Number(body.amount) || 0);
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  if (amount <= 0) return res.status(400).json({ error: 'Due amount must be greater than 0.' });
  const now = new Date().toISOString();
  const dateStr = String(body.date || '').slice(0, 10);
  const createdAt = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && dateStr <= now.slice(0, 10)
    ? `${dateStr}T00:00:00.000Z`
    : now;
  const note = String(body.note || '').trim();
  const n = (Number(store.settings.dueCounter) || 0) + 1;
  store.settings.dueCounter = n;
  const sale = {
    id: newId('sale'), invoiceNumber: `DUE-${String(n).padStart(4, '0')}`,
    type: 'opening_due', status: 'completed',
    customerName, customerPhone: String(body.customerPhone || '').trim(), customerPan: '',
    lines: [{
      inventory: false, itemId: null, sku: 'DUE', name: note || 'Opening balance (old khata)',
      category: 'other', quantity: 1, unitPrice: amount, lineTotal: amount,
      weightGrams: 0, karat: 0, makingCharge: 0, jartiRateType: null, jartiRateValue: 0, ratePerTola: 0
    }],
    subtotal: amount, discount: 0, afterDiscount: amount,
    taxType: 'percent', taxValue: 0, taxAmount: 0,
    oldGold: null, oldGoldCredit: 0, schemeId: null, schemeNumber: null, schemeCredit: 0,
    creditApplied: 0, creditOverflow: 0, total: amount,
    payment: { method: 'credit', received: 0, change: 0, due: amount },
    rateSnapshot: null, note,
    payments: [] as any[],
    voidedAt: null, voidReason: null,
    createdAt
  };
  store.sales.unshift(sale);
  // Old khata dues are credit too — add the matching Records → Credit entry.
  addLinkedCreditRecord(store, sale, now);
  upsertCustomerInStore(store, { name: customerName, phone: sale.customerPhone });
  await writeStore(store, req.userId);
  res.status(201).json(withDueFields(sale));
}));

router.get('/sales', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const start = req.query.start ? String(req.query.start).slice(0, 10) : null;
  const end = req.query.end ? String(req.query.end).slice(0, 10) : null;
  let sales = [...(store.sales || [])];
  if (start || end) sales = sales.filter((s: any) => inDateRange(s.createdAt, start, end));
  if (req.query.due === 'open') sales = sales.filter((s: any) => s.status !== 'voided' && saleDueRemaining(s) > 0);
  sales.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  const outstandingTotal = (store.sales || [])
    .filter((s: any) => s.status !== 'voided')
    .reduce((sum: number, s: any) => sum + saleDueRemaining(s), 0);
  res.json({ sales: sales.map(withDueFields), outstandingTotal });
}));

router.get('/sales/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const sale = (store.sales || []).find((s: any) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found.' });
  res.json(withDueFields(sale));
}));

/**
 * Record a payment received against a sale's outstanding due (credit sales
 * and partial cash sales). The invoice is untouched; each receipt is stored
 * on sale.payments[] and as a 'credit_payment' transaction for the audit
 * trail. Revenue is not double-counted — it was recognised at sale time.
 */
router.post('/sales/:id/payments', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const sale = (store.sales || []).find((s: any) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found.' });
  if (sale.status === 'voided') return res.status(400).json({ error: 'This sale is voided; no payments can be recorded.' });
  const dueRemaining = saleDueRemaining(sale);
  if (dueRemaining <= 0) return res.status(400).json({ error: 'This sale has no outstanding due.' });
  const body = req.body || {};
  const amount = Math.round(Number(body.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0.' });
  if (amount > dueRemaining) return res.status(400).json({ error: `Amount exceeds the outstanding due (${dueRemaining}).` });
  const method = PAYMENT_METHODS.includes(body.method) && body.method !== 'credit' ? body.method : 'cash';
  const now = new Date().toISOString();
  const payment = {
    id: newId('pay'), amount, method,
    date: String(body.date || now.slice(0, 10)),
    note: String(body.note || '').trim(), createdAt: now
  };
  if (!Array.isArray(sale.payments)) sale.payments = [];
  sale.payments.push(payment);
  store.transactions.unshift({
    id: newId('tx'), type: 'credit_payment', itemId: null,
    itemName: `Payment ${sale.invoiceNumber}`, quantity: 0, amount,
    note: `Payment received ${sale.invoiceNumber} — ${sale.customerName} · ${method}${payment.note ? ` · ${payment.note}` : ''}`,
    createdAt: now
  });
  // Mirror the receipt onto the linked Records → Credit entry, if any.
  const linkedOpt = (store.options || []).find((o: any) => o.saleId === sale.id);
  if (linkedOpt) {
    if (!Array.isArray(linkedOpt.payments)) linkedOpt.payments = [];
    linkedOpt.payments.push({
      id: newId('pay'), amount,
      date: payment.date,
      note: `${method.charAt(0).toUpperCase()}${method.slice(1)}${payment.note ? ` · ${payment.note}` : ''} (via invoice)`,
      createdAt: now
    });
    const paidTotal = linkedOpt.payments.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    if (paidTotal >= (Number(linkedOpt.cost) || 0)) linkedOpt.status = 'closed';
    linkedOpt.updatedAt = now;
  }
  await writeStore(store, req.userId);
  res.status(201).json({ payment, sale: withDueFields(sale) });
}));

/**
 * Void a sale. The original invoice is never edited or deleted — it is marked
 * voided (with a mandatory reason), stock is restored, its transaction entries
 * are tagged [VOIDED] so reports exclude them, a linked old-gold trade-in is
 * cancelled, and a redeemed scheme is reactivated.
 */
router.post('/sales/:id/void', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const sale = (store.sales || []).find((s: any) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found.' });
  if (sale.status === 'voided') return res.status(400).json({ error: 'Sale is already voided.' });
  if ((sale.payments || []).length) {
    return res.status(400).json({ error: 'Payments have been received against this sale. Settle or refund those first — this invoice can no longer be voided automatically.' });
  }
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required to void a sale.' });
  const now = new Date().toISOString();

  for (const line of sale.lines || []) {
    if (!line.inventory || !line.itemId) continue;
    const item = store.items.find((i: any) => i.id === line.itemId);
    if (!item) continue;
    item.quantity += line.quantity;
    if (item.quantity > 0) item.status = 'in_stock';
    item.updatedAt = now;
  }

  store.transactions.forEach((tx: any) => {
    if (tx.type === 'sale' && String(tx.note || '').includes(sale.invoiceNumber) && !String(tx.note || '').includes('[VOIDED]')) {
      tx.note = `${tx.note} [VOIDED]`;
    }
  });
  store.transactions.unshift({
    id: newId('tx'), type: 'void', itemId: null, itemName: `Void ${sale.invoiceNumber}`,
    quantity: 0, amount: -Number(sale.total || 0), note: `Void ${sale.invoiceNumber} — ${reason}`, createdAt: now
  });

  if (sale.oldGold) {
    const exchange = (store.oldGoldExchanges || []).find((e: any) => e.saleId === sale.id);
    if (exchange) { exchange.voided = true; exchange.voidedAt = now; }
  }

  if (sale.schemeId) {
    const scheme = (store.schemes || []).find((s: any) => s.id === sale.schemeId);
    if (scheme && scheme.status === 'redeemed' && scheme.saleId === sale.id) {
      scheme.status = 'active';
      delete scheme.redeemedAt; delete scheme.redeemedAmount; delete scheme.saleId; delete scheme.invoiceNumber;
      scheme.updatedAt = now;
    }
  }

  // Remove the linked Records → Credit entry (a voidable sale has no
  // receipts, so the linked record has no mirrored payments either).
  if (Array.isArray(store.options)) {
    store.options = store.options.filter((o: any) => o.saleId !== sale.id);
  }

  sale.status = 'voided';
  sale.voidedAt = now;
  sale.voidReason = reason;
  await writeStore(store, req.userId);
  res.json(sale);
}));

// ===== Repair jobs =====

const REPAIR_STATUSES = ['received', 'in_progress', 'ready', 'delivered', 'cancelled'];

router.get('/repairs', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  let repairs = [...(store.repairs || [])];
  if (req.query.status) repairs = repairs.filter((r: any) => r.status === req.query.status);
  repairs.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  res.json({ repairs });
}));

router.post('/repairs', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.repairs)) store.repairs = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const itemDescription = String(body.itemDescription || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  if (!itemDescription) return res.status(400).json({ error: 'Item description is required.' });
  const now = new Date().toISOString();
  const repair = {
    id: newId('rep'), repairNumber: nextRepairNumber(store), status: 'received',
    customerName, customerPhone: String(body.customerPhone || '').trim(),
    itemDescription, estimatedCharge: Math.max(0, Number(body.estimatedCharge) || 0),
    finalCharge: null, weightGrams: Number(body.weightGrams) || 0,
    karigarId: String(body.karigarId || '').trim() || null,
    karigarName: String(body.karigarName || '').trim(),
    promisedDate: String(body.promisedDate || '').trim(),
    notes: String(body.notes || '').trim(),
    deliveredAt: null, paymentMethod: null,
    createdAt: now, updatedAt: now
  };
  store.repairs.unshift(repair);
  upsertCustomerInStore(store, { name: customerName, phone: repair.customerPhone });
  await writeStore(store, req.userId);
  res.status(201).json(repair);
}));

router.patch('/repairs/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const repair = (store.repairs || []).find((r: any) => r.id === req.params.id);
  if (!repair) return res.status(404).json({ error: 'Repair not found.' });
  if (repair.status === 'delivered') return res.status(400).json({ error: 'Delivered repairs cannot be changed.' });
  const body = req.body || {};
  const now = new Date().toISOString();
  if (body.status != null) {
    const nextStatus = String(body.status);
    if (!REPAIR_STATUSES.includes(nextStatus)) return res.status(400).json({ error: 'Invalid repair status.' });
    if (nextStatus === 'delivered') {
      const charge = body.finalCharge != null && body.finalCharge !== ''
        ? Math.max(0, Number(body.finalCharge) || 0)
        : Math.max(0, Number(repair.estimatedCharge) || 0);
      const method = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : 'cash';
      repair.finalCharge = charge;
      repair.paymentMethod = method;
      repair.deliveredAt = now;
      if (charge > 0) {
        store.transactions.unshift({
          id: newId('tx'), type: 'sale', itemId: null, itemName: `Repair ${repair.repairNumber} — ${repair.itemDescription}`.slice(0, 120),
          quantity: 1, amount: charge, note: `Repair ${repair.repairNumber} — ${repair.customerName} · ${method}`, createdAt: now
        });
      }
    }
    repair.status = nextStatus;
  }
  if (body.customerName != null) repair.customerName = String(body.customerName).trim() || repair.customerName;
  if (body.customerPhone != null) repair.customerPhone = String(body.customerPhone).trim();
  if (body.itemDescription != null) repair.itemDescription = String(body.itemDescription).trim() || repair.itemDescription;
  if (body.estimatedCharge != null) repair.estimatedCharge = Math.max(0, Number(body.estimatedCharge) || 0);
  if (body.weightGrams != null) repair.weightGrams = Number(body.weightGrams) || 0;
  if (body.karigarId !== undefined) repair.karigarId = String(body.karigarId || '').trim() || null;
  if (body.karigarName != null) repair.karigarName = String(body.karigarName).trim();
  if (body.promisedDate != null) repair.promisedDate = String(body.promisedDate).trim();
  if (body.notes != null) repair.notes = String(body.notes).trim();
  repair.updatedAt = now;
  await writeStore(store, req.userId);
  res.json(repair);
}));

router.delete('/repairs/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const repair = (store.repairs || []).find((r: any) => r.id === req.params.id);
  if (!repair) return res.status(404).json({ error: 'Repair not found.' });
  if (repair.status !== 'cancelled') return res.status(400).json({ error: 'Only cancelled repairs can be deleted. Cancel it first.' });
  store.repairs = store.repairs.filter((r: any) => r.id !== req.params.id);
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

// ===== Customer item requests (requested items) =====
//
// A walk-in customer asks for a piece the shop does not have on the shelf.
// This records who asked and every item they asked for. It is deliberately
// NOT an order: nothing is reserved, priced, or deducted from stock.

const REQUEST_STATUSES = ['open', 'fulfilled', 'cancelled'];

function nextRequestNumber(store: any): string {
  const n = (Number(store.settings.requestCounter) || 0) + 1;
  store.settings.requestCounter = n;
  return `REQ-${String(n).padStart(4, '0')}`;
}

function requestItemFromInput(raw: any): any | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  return {
    id: String(raw.id || '').trim() || newId('ri'),
    itemId: String(raw.itemId || '').trim() || null,
    // Inventory code + unit, kept so the Requested list can show them (and so
    // editing a request does not drop what the customer link sent).
    itemCode: String(raw.itemCode || '').trim().slice(0, 60),
    unit: String(raw.unit || '').trim().slice(0, 40),
    name: name.slice(0, 200),
    category: String(raw.category || '').trim(),
    karat: Number(raw.karat) || 0,
    weightGrams: Math.max(0, Number(raw.weightGrams) || 0),
    quantity: Math.max(1, Math.floor(Number(raw.quantity) || 1)),
    price: Math.max(0, Number(raw.price) || 0),
    note: String(raw.note || '').trim().slice(0, 300)
  };
}

function requestItemsFromInput(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(requestItemFromInput).filter((i: any) => i !== null);
}

router.get('/requests', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const all = [...(store.requests || [])];
  let requests = all;
  if (req.query.status) requests = requests.filter((r: any) => r.status === req.query.status);
  requests.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json({ requests, openCount: all.filter((r: any) => r.status === 'open').length });
}));

router.post('/requests', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.requests)) store.requests = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  const items = requestItemsFromInput(body.items);
  if (!items.length) return res.status(400).json({ error: 'Add at least one requested item.' });
  const now = new Date().toISOString();
  const entry = {
    id: newId('req'),
    requestNumber: nextRequestNumber(store),
    status: 'open',
    customerName: customerName.slice(0, 120),
    customerPhone: String(body.customerPhone || '').trim(),
    items,
    note: String(body.note || '').trim().slice(0, 500),
    fulfilledAt: null as string | null,
    createdAt: now,
    updatedAt: now
  };
  store.requests.unshift(entry);
  upsertCustomerInStore(store, { name: entry.customerName, phone: entry.customerPhone });
  await writeStore(store, req.userId);
  res.status(201).json(entry);
}));

router.patch('/requests/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const entry = (store.requests || []).find((r: any) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Request not found.' });
  const body = req.body || {};
  const now = new Date().toISOString();
  if (body.status != null) {
    const next = String(body.status);
    if (!REQUEST_STATUSES.includes(next)) return res.status(400).json({ error: 'Invalid request status.' });
    entry.fulfilledAt = next === 'fulfilled' ? now : null;
    entry.status = next;
  }
  if (body.customerName != null) entry.customerName = String(body.customerName).trim().slice(0, 120) || entry.customerName;
  if (body.customerPhone != null) entry.customerPhone = String(body.customerPhone).trim();
  if (body.items !== undefined) {
    const items = requestItemsFromInput(body.items);
    if (!items.length) return res.status(400).json({ error: 'Add at least one requested item.' });
    entry.items = items;
  }
  if (body.note != null) entry.note = String(body.note).trim().slice(0, 500);
  entry.updatedAt = now;
  await writeStore(store, req.userId);
  res.json(entry);
}));

router.delete('/requests/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const entry = (store.requests || []).find((r: any) => r.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Request not found.' });
  store.requests = store.requests.filter((r: any) => r.id !== req.params.id);
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

// ===== Public customer request link (no login) =====
//
// The shop shares one unguessable link — /order/<code> — with customers. The
// page behind it (public/customer.html) may do exactly three things:
//
//   GET  /api/public/<code>/items     read-only, in-stock inventory + rates
//   GET  /api/public/<code>/requests  the caller's own requests (name+phone must match)
//   POST /api/public/<code>/requests  file a new request
//
// Everything else still needs a signed-in shop token. The code is derived, not
// stored: HMAC(userId, PUBLIC_REQUEST_SALT). This mirrors the Laravel backend's
// PublicRequestController so the same page works against either server.

const PUBLIC_ITEM_FIELDS = [
  'id', 'itemNumber', 'sku', 'name', 'category', 'karat', 'weightGrams', 'weightUnit',
  'makingCharge', 'jartiRateType', 'jartiRateValue', 'salePrice', 'customRatePerTola',
  'stoneAmount', 'quantity', 'status', 'hallmark'
];
const PUBLIC_MAX_ITEMS = 25;

function publicRequestSalt(): string {
  return String(process.env.PUBLIC_REQUEST_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'subarnapasal-local');
}

export function publicRequestCodeFor(userId: string): string {
  return crypto.createHmac('sha256', publicRequestSalt())
    .update(`subarnapasal-public-request:${userId}`)
    .digest('hex')
    .slice(0, 20);
}

function resolvePublicShop(code: any): string | null {
  const clean = String(code || '').toLowerCase().replace(/[^a-f0-9]/g, '');
  if (!clean) return null;
  const ids = [LOCAL_DEV_USER_ID, ...listStoreUserIds()];
  for (const userId of ids) {
    const expected = publicRequestCodeFor(userId);
    if (expected.length !== clean.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return userId;
  }
  return null;
}

function publicItemAvailable(item: any): boolean {
  const status = String(item.status || '').toLowerCase();
  return Math.floor(Number(item.quantity) || 0) > 0 && status !== 'sold' && status !== 'sold_out';
}

/** Unit the available quantity is counted in, e.g. "piece (10.5 g each)". */
function publicUnitLabel(item: any): string {
  const grams = Number(item.weightGrams) || 0;
  if (grams > 0 && String(item.weightUnit || '').toLowerCase() === 'tola') {
    return `piece (${Number((grams / TOLA_GRAMS).toFixed(3))} tola each)`;
  }
  if (grams > 0) return `piece (${Number(grams.toFixed(3))} g each)`;
  return 'piece';
}

// Small in-memory limiter so a shared link cannot be hammered.
const publicHits = new Map<string, { count: number; resetAt: number }>();
function publicRateLimited(req: any, limit: number): boolean {
  const key = `${req.ip || 'anon'}:${req.path}`;
  const now = Date.now();
  const hit = publicHits.get(key);
  if (!hit || now > hit.resetAt) { publicHits.set(key, { count: 1, resetAt: now + 60_000 }); return false; }
  hit.count += 1;
  return hit.count > limit;
}

router.get('/public/:code/items', asyncRoute(async (req: any, res) => {
  if (publicRateLimited(req, 120)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  const userId = resolvePublicShop(req.params.code);
  if (!userId) return res.status(404).json({ error: 'This link is not valid.' });

  const store = await readStore(userId);
  const items = (store.items || [])
    .filter((item: any) => item && publicItemAvailable(item))
    .map((item: any) => {
      const out: any = {};
      for (const field of PUBLIC_ITEM_FIELDS) if (item[field] !== undefined) out[field] = item[field];
      return out;
    })
    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));

  const metals = await resolveMetalRates(store);
  res.json({
    shopName: store.settings?.shopName || 'SubarnaPasal',
    shopPhone: store.settings?.shopPhone || '',
    currency: store.settings?.currency || 'NPR',
    items,
    goldRatePerTola: metals.goldRatePerTola,
    silverRatePerTola: metals.silverRatePerTola,
    metalRatesLive: metals.live,
    metalCurrency: metals.currency
  });
}));

router.get('/public/:code/requests', asyncRoute(async (req: any, res) => {
  if (publicRateLimited(req, 60)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  const userId = resolvePublicShop(req.params.code);
  if (!userId) return res.status(404).json({ error: 'This link is not valid.' });

  // Name AND phone must match, so one customer cannot read another's list.
  const name = String(req.query.name || '').trim().toLowerCase();
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!name || !phone) return res.json({ requests: [] });

  const store = await readStore(userId);
  const mine = (store.requests || []).filter((r: any) =>
    String(r.customerName || '').trim().toLowerCase() === name
    && String(r.customerPhone || '').replace(/\D/g, '') === phone);
  mine.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  res.json({ requests: mine });
}));

router.post('/public/:code/requests', asyncRoute(async (req: any, res) => {
  if (publicRateLimited(req, 20)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  const userId = resolvePublicShop(req.params.code);
  if (!userId) return res.status(404).json({ error: 'This link is not valid.' });

  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  if (!customerName) return res.status(400).json({ error: 'Your name is required.' });
  const customerPhone = String(body.customerPhone || '').trim();
  if (!customerPhone.replace(/\D/g, '')) return res.status(400).json({ error: 'Your phone number is required.' });

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length > PUBLIC_MAX_ITEMS) {
    return res.status(400).json({ error: `Too many items in one request. Please send at most ${PUBLIC_MAX_ITEMS}.` });
  }

  const store = await readStore(userId);
  if (!Array.isArray(store.requests)) store.requests = [];

  // Lines are rebuilt from the shop's own inventory: a bad or sold-out itemId
  // is dropped, and name / weight / karat / price never come from the body.
  const byId = new Map<string, any>();
  for (const item of (store.items || [])) if (item && item.id) byId.set(String(item.id), item);

  const items: any[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const item = byId.get(String(raw.itemId || ''));
    if (!item || !publicItemAvailable(item)) continue;
    const available = Math.floor(Number(item.quantity) || 0);
    const wanted = Math.max(1, Math.floor(Number(raw.quantity) || 1));
    items.push({
      id: newId('ri'),
      itemId: String(item.id),
      itemCode: String(item.itemNumber || item.sku || '').slice(0, 60),
      name: String(item.name || '').slice(0, 200),
      category: String(item.category || ''),
      unit: publicUnitLabel(item),
      karat: Number(item.karat) || 0,
      weightGrams: Math.max(0, Number(item.weightGrams) || 0),
      quantity: Math.min(available, wanted),   // never more than the shelf holds
      price: Math.max(0, Number(item.salePrice) || 0),
      note: ''
    });
  }
  if (!items.length) return res.status(400).json({ error: 'Pick at least one item that is still in stock.' });

  const now = new Date().toISOString();
  const entry = {
    id: newId('req'),
    requestNumber: nextRequestNumber(store),
    status: 'open',                 // shown as "Pending" until the shop acts on it
    customerName: customerName.slice(0, 120),
    customerPhone: customerPhone.slice(0, 40),
    items,
    note: String(body.note || '').trim().slice(0, 500),
    source: 'link',
    fulfilledAt: null as string | null,
    createdAt: now,
    updatedAt: now
  };
  store.requests.unshift(entry);
  upsertCustomerInStore(store, { name: entry.customerName, phone: entry.customerPhone });
  await writeStore(store, userId);
  res.status(201).json(entry);
}));

/** Signed-in shop owner: "what link do I share with customers?" */
router.get('/public-link', asyncRoute(async (req: any, res) => {
  const code = publicRequestCodeFor(req.userId);
  const base = String(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '')
    || `${req.protocol}://${req.get('host')}`;
  res.json({ code, url: `${base}/order/${code}`, pageUrl: `${base}/customer.html?shop=${code}` });
}));

// ===== Monthly gold savings schemes =====

router.get('/schemes', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  let schemes = [...(store.schemes || [])];
  if (req.query.status) schemes = schemes.filter((s: any) => s.status === req.query.status);
  schemes.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  res.json({ schemes: schemes.map((s: any) => ({ ...s, paidTotal: schemePaidTotal(s) })) });
}));

router.post('/schemes', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.schemes)) store.schemes = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const monthlyAmount = Math.max(0, Number(body.monthlyAmount) || 0);
  const durationMonths = Math.max(1, Math.floor(Number(body.durationMonths) || 12));
  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  if (monthlyAmount <= 0) return res.status(400).json({ error: 'Monthly amount must be greater than 0.' });
  const now = new Date().toISOString();
  const scheme = {
    id: newId('gs'), schemeNumber: nextSchemeNumber(store), status: 'active',
    customerName, customerPhone: String(body.customerPhone || '').trim(),
    monthlyAmount, durationMonths,
    startDate: String(body.startDate || now.slice(0, 10)),
    installments: [] as any[],
    notes: String(body.notes || '').trim(),
    createdAt: now, updatedAt: now
  };
  store.schemes.unshift(scheme);
  upsertCustomerInStore(store, { name: customerName, phone: scheme.customerPhone });
  await writeStore(store, req.userId);
  res.status(201).json({ ...scheme, paidTotal: 0 });
}));

router.post('/schemes/:id/installments', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const scheme = (store.schemes || []).find((s: any) => s.id === req.params.id);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });
  if (scheme.status !== 'active') return res.status(400).json({ error: `Scheme is ${scheme.status}; deposits are only allowed while active.` });
  const body = req.body || {};
  const amount = Math.max(0, Number(body.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Deposit amount must be greater than 0.' });
  const now = new Date().toISOString();
  const installment = {
    id: newId('ins'), amount,
    date: String(body.date || now.slice(0, 10)),
    method: PAYMENT_METHODS.includes(body.method) ? body.method : 'cash',
    note: String(body.note || '').trim(), createdAt: now
  };
  if (!Array.isArray(scheme.installments)) scheme.installments = [];
  scheme.installments.push(installment);
  const paidTotal = schemePaidTotal(scheme);
  if ((scheme.installments.length >= scheme.durationMonths) || paidTotal >= scheme.monthlyAmount * scheme.durationMonths) {
    scheme.status = 'matured';
  }
  scheme.updatedAt = now;
  await writeStore(store, req.userId);
  res.status(201).json({ installment, scheme: { ...scheme, paidTotal } });
}));

router.patch('/schemes/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const scheme = (store.schemes || []).find((s: any) => s.id === req.params.id);
  if (!scheme) return res.status(404).json({ error: 'Scheme not found.' });
  if (scheme.status === 'redeemed') return res.status(400).json({ error: 'Redeemed schemes cannot be changed. Void the linked sale to reactivate.' });
  const body = req.body || {};
  if (body.status != null) {
    const allowed = ['active', 'matured', 'cancelled'];
    if (!allowed.includes(String(body.status))) return res.status(400).json({ error: 'Invalid scheme status.' });
    scheme.status = String(body.status);
  }
  if (body.notes != null) scheme.notes = String(body.notes).trim();
  if (body.customerPhone != null) scheme.customerPhone = String(body.customerPhone).trim();
  scheme.updatedAt = new Date().toISOString();
  await writeStore(store, req.userId);
  res.json({ ...scheme, paidTotal: schemePaidTotal(scheme) });
}));

// ===== Dashboard (single aggregate call for the home screen) =====

router.get('/dashboard', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  const metals = await resolveMetalRates(store);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  const sales = (store.sales || []).filter((s: any) => s.status !== 'voided');
  // Opening-balance dues (type 'opening_due') owe money but are not revenue.
  const revenueSales = sales.filter((s: any) => s.type !== 'opening_due');
  const sumTotals = (list: any[]) => list.reduce((a: number, s: any) => a + (Number(s.total) || 0), 0);
  const todaySales = revenueSales.filter((s: any) => String(s.createdAt).slice(0, 10) === today);
  const monthSales = revenueSales.filter((s: any) => String(s.createdAt).slice(0, 10) >= monthStart);

  // Last 7 days of invoice revenue.
  const salesByDay = [...Array(7)].map((_, i) => {
    const d = new Date(now.getTime() - (6 - i) * 86400000).toISOString().slice(0, 10);
    const daySales = revenueSales.filter((s: any) => String(s.createdAt).slice(0, 10) === d);
    return { date: d, amount: sumTotals(daySales), count: daySales.length };
  });

  const outstandingTotal = sales.reduce((a: number, s: any) => a + saleDueRemaining(s), 0);
  const openDues = sales
    .filter((s: any) => saleDueRemaining(s) > 0)
    .slice(0, 6)
    .map((s: any) => ({ id: s.id, invoiceNumber: s.invoiceNumber, customerName: s.customerName, dueRemaining: saleDueRemaining(s), createdAt: s.createdAt }));

  const inStock = store.items.filter((i: any) => i.status === 'in_stock' && i.quantity > 0);
  const inventoryValue = inStock.reduce((sum: number, i: any) => sum + itemValue(i, metals) * i.quantity, 0);
  const totalWeightGrams = inStock.reduce((sum: number, i: any) => sum + (Number(i.weightGrams) || 0) * i.quantity, 0);
  const lowStockCount = store.items.filter((i: any) => i.status === 'in_stock' && i.quantity <= 1).length;

  const pendingOrders = (store.orders || []).filter((o: any) => ['pending', 'confirmed', 'progress', 'ready'].includes(o.status)).length;
  const activeRepairs = (store.repairs || []).filter((r: any) => ['received', 'in_progress', 'ready'].includes(r.status)).length;
  const activeSchemes = (store.schemes || []).filter((s: any) => s.status === 'active' || s.status === 'matured').length;

  const recentSales = sales.slice(0, 6).map((s: any) => ({
    id: s.id, invoiceNumber: s.invoiceNumber, customerName: s.customerName,
    total: s.total, method: s.payment?.method || 'cash', dueRemaining: saleDueRemaining(s), createdAt: s.createdAt
  }));

  res.json({
    date: today,
    goldRatePerTola: Number(metals.goldRatePerTola) || 0,
    silverRatePerTola: Number(metals.silverRatePerTola) || 0,
    metalRatesLive: Boolean(metals.live),
    today: { revenue: sumTotals(todaySales), count: todaySales.length },
    month: { revenue: sumTotals(monthSales), count: monthSales.length },
    salesByDay,
    outstandingTotal, openDues,
    inventory: { value: inventoryValue, items: inStock.reduce((s: number, i: any) => s + i.quantity, 0), weightGrams: Number(totalWeightGrams.toFixed(2)), lowStockCount },
    pendingOrders, activeRepairs, activeSchemes,
    recentSales
  });
}));

// ── Options (Taken / Given / Kept) ──────────────────────────────────────────

router.get('/options', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  res.json(store.options || []);
}));

router.post('/options', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.options)) store.options = [];
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const type = ['taken', 'given', 'kept', 'credit', 'borrow', 'deposit'].includes(body.type) ? body.type : 'credit';
  const metal = ['cash', 'gold', 'silver', 'other'].includes(body.metal)
    ? body.metal
    : ((Number(body.weightGrams) || 0) > 0 ? 'gold' : 'cash');
  const now = new Date().toISOString();
  const option = {
    id: newId('opt'), type, metal, name,
    item: String(body.item || '').trim(),
    weightGrams: Number(body.weightGrams) || 0,
    karat: Number(body.karat) || 22,
    rate: Number(body.rate) || 0,
    cost: Number(body.cost) || 0,
    date: String(body.date || now.slice(0, 10)),
    committedDate: String(body.committedDate || ''),
    notes: String(body.notes || '').trim(),
    payments: [],
    status: 'open',
    createdAt: now, updatedAt: now
  };
  store.options.unshift(option);
  await writeStore(store, req.userId);
  res.status(201).json(option);
}));

router.put('/options/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.options)) store.options = [];
  const idx = store.options.findIndex((o: any) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Option not found.' });
  const opt = store.options[idx];
  const body = req.body || {};
  if (body.name != null) opt.name = String(body.name).trim();
  if (body.item != null) opt.item = String(body.item).trim();
  if (body.type != null && ['taken', 'given', 'kept', 'credit', 'borrow', 'deposit'].includes(body.type)) opt.type = body.type;
  if (body.metal != null && ['cash', 'gold', 'silver', 'other'].includes(body.metal)) opt.metal = body.metal;
  if (body.weightGrams != null) opt.weightGrams = Number(body.weightGrams) || 0;
  if (body.karat != null) opt.karat = Number(body.karat) || 22;
  if (body.rate != null) opt.rate = Number(body.rate) || 0;
  if (body.cost != null) opt.cost = Number(body.cost) || 0;
  if (body.date != null) opt.date = String(body.date);
  if (body.committedDate != null) opt.committedDate = String(body.committedDate);
  if (body.notes != null) opt.notes = String(body.notes).trim();
  if (body.status != null && ['open', 'closed'].includes(body.status)) opt.status = body.status;
  opt.updatedAt = new Date().toISOString();
  store.options[idx] = opt;
  await writeStore(store, req.userId);
  res.json(opt);
}));

router.delete('/options/:id', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.options)) store.options = [];
  const before = store.options.length;
  store.options = store.options.filter((o: any) => o.id !== req.params.id);
  if (store.options.length === before) return res.status(404).json({ error: 'Option not found.' });
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

router.post('/options/:id/payments', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.options)) store.options = [];
  const opt = store.options.find((o: any) => o.id === req.params.id);
  if (!opt) return res.status(404).json({ error: 'Option not found.' });
  if (opt.saleId) return res.status(400).json({ error: 'This record is linked to an invoice — receive payments in Reports → Invoices.' });
  const body = req.body || {};
  const amount = Number(body.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0.' });
  const now = new Date().toISOString();
  const payment = {
    id: newId('pay'), amount,
    date: String(body.date || now.slice(0, 10)),
    note: String(body.note || '').trim(),
    createdAt: now
  };
  if (!Array.isArray(opt.payments)) opt.payments = [];
  opt.payments.push(payment);
  opt.updatedAt = now;
  await writeStore(store, req.userId);
  res.status(201).json({ payment, option: opt });
}));

// Edit a payment entry (amount / date / note) on a record.
router.put('/options/:id/payments/:paymentId', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.options)) store.options = [];
  const opt = store.options.find((o: any) => o.id === req.params.id);
  if (!opt) return res.status(404).json({ error: 'Option not found.' });
  if (opt.saleId) return res.status(400).json({ error: 'This record is linked to an invoice — its payments cannot be edited here.' });
  if (!Array.isArray(opt.payments)) opt.payments = [];
  const payment = opt.payments.find((p: any) => p.id === req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  const body = req.body || {};
  if (body.amount != null) {
    const amount = Number(body.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0.' });
    payment.amount = amount;
  }
  if (body.date != null) payment.date = String(body.date).slice(0, 10);
  if (body.note != null) payment.note = String(body.note).trim();
  payment.updatedAt = new Date().toISOString();
  opt.updatedAt = payment.updatedAt;
  await writeStore(store, req.userId);
  res.json({ payment, option: opt });
}));

router.delete('/options/:id/payments/:paymentId', asyncRoute(async (req: any, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.options)) store.options = [];
  const opt = store.options.find((o: any) => o.id === req.params.id);
  if (!opt) return res.status(404).json({ error: 'Option not found.' });
  if (opt.saleId) return res.status(400).json({ error: 'This record is linked to an invoice — its payments cannot be removed here.' });
  if (!Array.isArray(opt.payments)) opt.payments = [];
  const before = opt.payments.length;
  opt.payments = opt.payments.filter((p: any) => p.id !== req.params.paymentId);
  if (opt.payments.length === before) return res.status(404).json({ error: 'Payment not found.' });
  opt.updatedAt = new Date().toISOString();
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

export default router;

