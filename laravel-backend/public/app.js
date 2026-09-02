// Escapes text before it is interpolated into an HTML template literal.
// Global on purpose: the other classic scripts reuse it.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOLA_GRAMS = 11.664;
const AANA_PER_TOLA = 16;
const LAAL_PER_AANA = 6.25;
const LAAL_PER_TOLA = AANA_PER_TOLA * LAAL_PER_AANA;
const fmt = new Intl.NumberFormat('en-NP');

const CURRENCIES = {
  NPR: { code: 'NPR', label: 'NPR — Nepalese Rupee (रू)', nprPerUnit: 1, locale: 'en-NP' },
  USD: { code: 'USD', label: 'USD — US Dollar ($)', nprPerUnit: 133, locale: 'en-US' },
  CAD: { code: 'CAD', label: 'CAD — Canadian Dollar (CA$)', nprPerUnit: 98, locale: 'en-CA' }
};

let displayCurrency = 'NPR';
const moneyFormatters = {};
const THEME_STORAGE_KEY = 'subarnapasal.theme';

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (next === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (_) { /* ignore */ }
  updateThemeToggleUI();
}

function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  toast(t(getTheme() === 'dark' ? 'themeDarkOn' : 'themeLightOn'));
}

function initTheme() {
  let theme = 'light';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch (_) { /* ignore */ }
  applyTheme(theme);
}

function updateThemeToggleUI() {
  const isDark = getTheme() === 'dark';
  const label = isDark ? t('themeDark') : t('themeLight');
  ['theme-toggle', 'pos-theme-toggle'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  });
}

function getCurrency() {
  return CURRENCIES[displayCurrency] || CURRENCIES.NPR;
}

function currencyCode() {
  return getCurrency().code;
}

function nprToDisplay(npr) {
  return Number(npr) / getCurrency().nprPerUnit;
}

function displayToNpr(amount) {
  return Number(amount) * getCurrency().nprPerUnit;
}

function displayToNprAt(amount, currency) {
  const c = CURRENCIES[currency] || CURRENCIES.USD;
  return Number(amount) * c.nprPerUnit;
}

function inputMoneyToNpr(amount) {
  const value = Number(amount) || 0;
  return displayCurrency === 'NPR' ? value : displayToNpr(value);
}

function formatMoney(npr) {
  const c = getCurrency();
  if (!moneyFormatters[c.code]) {
    moneyFormatters[c.code] = new Intl.NumberFormat(c.locale, {
      style: 'currency',
      currency: c.code,
      maximumFractionDigits: c.code === 'NPR' ? 0 : 2,
      minimumFractionDigits: c.code === 'NPR' ? 0 : 2
    });
  }
  return moneyFormatters[c.code].format(nprToDisplay(npr));
}

function formatMoneyPlain(npr) {
  const amount = nprToDisplay(npr);
  return currencyCode() === 'NPR' ? fmt.format(amount) : amount.toFixed(2);
}

function labelWithCurrency(key) {
  return `${t(key)} (${currencyCode()})`;
}

function setDisplayCurrency(code) {
  displayCurrency = CURRENCIES[code] ? code : 'NPR';
}

function metalApiQueryCurrency() {
  const code = currencyCode();
  return code === 'NPR' ? 'USD' : code;
}

function liveMetalRatesToNpr(live) {
  const rateCurrency = live.currency || metalApiQueryCurrency();
  return {
    goldPerTola: displayToNprAt(live.gold.perTola, rateCurrency),
    goldPerGram: displayToNprAt(live.gold.perGram, rateCurrency),
    silverPerTola: displayToNprAt(live.silver.perTola, rateCurrency),
    silverPerGram: displayToNprAt(live.silver.perGram, rateCurrency)
  };
}

function formatLiveMetalRateLine(metal, perTolaNpr, perGramNpr) {
  return `${metal}: ${formatMoney(perTolaNpr)}/tola · ${formatMoney(perGramNpr)}/g`;
}

function initCurrencySelect() {
  const sel = document.getElementById('currency-select');
  if (!sel) return;
  sel.innerHTML = Object.entries(CURRENCIES)
    .map(([code, c]) => `<option value="${code}">${c.label}</option>`)
    .join('');
  sel.value = displayCurrency;
}

function parseMoneyField(value) {
  return parseRateInput(value);
}

function formatMoneyField(npr) {
  return formatRateInput(npr);
}

// Spell out an amount for the invoice ("...in words") using the South-Asian
// numbering system (thousand / lakh / crore) that Nepali bills use.
function numberToWordsIndian(num) {
  num = Math.floor(Math.abs(Number(num) || 0));
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const twoDigit = (n) => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`;
  const threeDigit = (n) => {
    const h = Math.floor(n / 100), r = n % 100;
    return `${h ? ones[h] + ' Hundred' + (r ? ' ' : '') : ''}${r ? twoDigit(r) : ''}`;
  };
  const parts = [];
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  if (crore) parts.push(numberToWordsIndian(crore) + ' Crore');
  if (lakh) parts.push(twoDigit(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigit(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigit(hundred));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function currencyWordUnit() {
  const code = currencyCode();
  if (code === 'NPR') return 'Rupees';
  if (code === 'USD') return 'US Dollars';
  if (code === 'CAD') return 'Canadian Dollars';
  return code;
}

function amountToWords(npr) {
  const amount = Math.round(nprToDisplay(npr));
  return `${currencyWordUnit()} ${numberToWordsIndian(amount)} Only`;
}

// ---- Nepali (Devanagari) amount-in-words for the guarantee bill ----
const NEPALI_NUMBER_WORDS = ['सुन्ना', 'एक', 'दुई', 'तीन', 'चार', 'पाँच', 'छ', 'सात', 'आठ', 'नौ', 'दश',
  'एघार', 'बाह्र', 'तेह्र', 'चौध', 'पन्ध्र', 'सोह्र', 'सत्र', 'अठार', 'उन्नाइस', 'बीस',
  'एक्काइस', 'बाइस', 'तेइस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताइस', 'अठ्ठाइस', 'उनन्तीस', 'तीस',
  'एकतीस', 'बत्तीस', 'तेत्तीस', 'चौँतीस', 'पैँतीस', 'छत्तीस', 'सैँतीस', 'अठतीस', 'उनन्चालीस', 'चालीस',
  'एकचालीस', 'बयालीस', 'त्रिचालीस', 'चवालीस', 'पैँतालीस', 'छयालीस', 'सतचालीस', 'अठचालीस', 'उनन्चास', 'पचास',
  'एकाउन्न', 'बाउन्न', 'त्रिपन्न', 'चवन्न', 'पचपन्न', 'छपन्न', 'सन्ताउन्न', 'अन्ठाउन्न', 'उनन्साठी', 'साठी',
  'एकसट्ठी', 'बयसट्ठी', 'त्रिसट्ठी', 'चौंसट्ठी', 'पैंसट्ठी', 'छयसट्ठी', 'सतसट्ठी', 'अठसट्ठी', 'उनन्सत्तरी', 'सत्तरी',
  'एकहत्तर', 'बहत्तर', 'त्रिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छयहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी', 'असी',
  'एकासी', 'बयासी', 'त्रियासी', 'चौरासी', 'पचासी', 'छयासी', 'सतासी', 'अठासी', 'उनान्नब्बे', 'नब्बे',
  'एकानब्बे', 'बयानब्बे', 'त्रियानब्बे', 'चौरानब्बे', 'पन्चानब्बे', 'छयानब्बे', 'सन्तानब्बे', 'अन्ठानब्बे', 'उनान्सय'];

function numberToWordsNepali(num) {
  num = Math.round(Math.abs(Number(num) || 0));
  if (num === 0) return NEPALI_NUMBER_WORDS[0];
  const parts = [];
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = Math.floor(num / 100); num %= 100;
  if (crore) parts.push(`${numberToWordsNepali(crore)} करोड`);
  if (lakh) parts.push(`${NEPALI_NUMBER_WORDS[lakh]} लाख`);
  if (thousand) parts.push(`${NEPALI_NUMBER_WORDS[thousand]} हजार`);
  if (hundred) parts.push(`${NEPALI_NUMBER_WORDS[hundred]} सय`);
  if (num) parts.push(NEPALI_NUMBER_WORDS[num]);
  return parts.join(' ');
}

function amountToWordsNepali(npr) {
  const amount = Math.round(nprToDisplay(npr));
  return `रुपैयाँ ${numberToWordsNepali(amount)} मात्र।`;
}

function toDevanagariDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => '०१२३४५६७८९'[Number(d)]);
}

function refreshDisplayPrices() {
  renderPosCatalog();
  renderInventoryTable();
  renderCart();
  populateOrderItemSelect();
  updateOrderTotalPreview();
  updateCustomItemPricePreview();
  renderRateHistoryChart();
  renderRateHistoryTable();
  if (reportCache && activeView === 'reports') {
    const expenses = expensesInRange(reportCache.period?.start, reportCache.period?.end);
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const netProfit = reportCache.sales.revenue - expenseTotal;
    updateReportSectionTitle();
    if (reportTab === 'inventory') renderInventoryReport(reportCache);
    else if (reportTab === 'customer') renderCustomerReport(reportCache);
    else if (reportTab === 'invoices' && typeof renderInvoicesReport === 'function') renderInvoicesReport();
    else renderSalesReport(reportCache, expenseTotal, netProfit);
  }
}

function formatRateHistoryDate(row) {
  const raw = row.date || String(row.updatedAt || '').slice(0, 10);
  if (!raw) return '—';
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString();
}

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayDateStr() {
  return localDateStr();
}

function rowLocalDateStr(row) {
  if (row.updatedAt) return localDateStr(new Date(row.updatedAt));
  return row.date || String(row.updatedAt || '').slice(0, 10);
}

function isRowToday(row) {
  return rowLocalDateStr(row) === todayDateStr();
}

function localDayStartIso(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();
}

// Live API pricing was removed — rates always come from Settings.
function isLiveDailyApiMode() {
  return false;
}

const DAILY_CHART_MIN_GAP_MS = 1000;
const DAY_SECONDS = 86400;
const LIVE_DAILY_MAX_TICKS_PER_DAY = 86400;

function daySecondFromIso(iso) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 0;
  return dt.getHours() * 3600 + dt.getMinutes() * 60 + dt.getSeconds();
}

function format24HourClock(daySecond) {
  const sec = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(daySecond)));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function resetLiveDailySecondSeries() {
  liveDailySecondSeries = [];
  liveDailySecondSeq = 0;
}

function pushLiveDailySecondTick(tolaNpr, gramNpr, saved = false) {
  if (!tolaNpr || tolaNpr <= 0) return;
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  const now = new Date();
  const updatedAt = now.toISOString();
  const daySecond = daySecondFromIso(updatedAt);
  liveDailySecondSeq += 1;
  const entry = {
    date: todayDateStr(),
    updatedAt,
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gram,
    daySecond,
    secondNum: liveDailySecondSeq,
    value: nprToDisplay(tolaNpr),
    saved: !!saved,
    priceMode: 'api'
  };
  const sameSlot = liveDailySecondSeries.findIndex(
    (row) => row.date === entry.date && row.daySecond === daySecond
  );
  if (sameSlot >= 0) liveDailySecondSeries[sameSlot] = entry;
  else liveDailySecondSeries.push(entry);
  liveDailySecondSeries.sort((a, b) => a.daySecond - b.daySecond || a.updatedAt.localeCompare(b.updatedAt));
  const today = todayDateStr();
  liveDailySecondSeries = liveDailySecondSeries
    .filter((row) => row.date === today)
    .slice(-LIVE_DAILY_MAX_TICKS_PER_DAY);
}

function chartRowTimeMs(row) {
  if (row.chartTime != null) return row.chartTime;
  return new Date(row.updatedAt || row.date).getTime();
}

function nextChartTimeAfter(lastRow, minGapMs = DAILY_CHART_MIN_GAP_MS) {
  const now = Date.now();
  if (!lastRow) return now;
  const lastT = new Date(lastRow.updatedAt).getTime();
  return Math.max(now, lastT + minGapMs);
}

function spreadDailyChartTimestamps(rows) {
  if (!rows.length) return rows;
  const out = rows.map((row) => ({
    ...row,
    chartTime: chartRowTimeMs(row)
  }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const curr = out[i];
    const minT = prev.chartTime + DAILY_CHART_MIN_GAP_MS;
    if (curr.value !== prev.value || curr.chartTime <= prev.chartTime) {
      if (curr.chartTime < minT) curr.chartTime = minT;
    }
    const spreadIso = new Date(curr.chartTime).toISOString();
    if (spreadIso !== curr.updatedAt) {
      curr.label = formatRateHistoryIntradayLabel(spreadIso);
    }
  }
  return out;
}

function normalizeRateHistoryRow(row) {
  const updatedAt = row.updatedAt
    || (row.date ? `${row.date}T12:00:00.000Z` : new Date().toISOString());
  return {
    ...row,
    date: row.date || String(updatedAt).slice(0, 10),
    updatedAt,
    priceMode: row.priceMode === 'api' ? 'api' : 'manual'
  };
}

function formatRateHistoryIntradayLabel(updatedAt) {
  if (!updatedAt) return '—';
  const dt = new Date(updatedAt);
  if (Number.isNaN(dt.getTime())) return updatedAt;
  return dt.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatRateHistoryTableWhen(row) {
  if (isRowToday(row)) {
    return `${formatRateHistoryDate(row)} · ${formatRateHistoryIntradayLabel(row.updatedAt)}`;
  }
  return formatRateHistoryDate(row);
}

function todaySavedRateRows() {
  const mode = currentRateHistoryPriceMode();
  return liveDailyReadings
    .filter((row) => row.priceMode === mode && isRowToday(row))
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));
}

function rowToDailyChartPoint(row, opts = {}) {
  return {
    date: row.date || String(row.updatedAt || '').slice(0, 10),
    updatedAt: row.updatedAt || null,
    goldRatePerTola: row.goldRatePerTola,
    value: nprToDisplay(row.goldRatePerTola),
    bucket: row.updatedAt || row.date,
    label: formatRateHistoryIntradayLabel(row.updatedAt),
    liveTick: !!opts.liveTick,
    saved: !!opts.saved,
    flatAnchor: !!opts.flatAnchor
  };
}

function ensureLiveDailyFlatAnchor(tolaNpr, gramNpr) {
  const saved = todaySavedRateRows();
  if (saved.length) {
    liveDailyFlatAnchor = null;
    return;
  }
  if (!tolaNpr || tolaNpr <= 0) return;
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  if (!liveDailyFlatAnchor) {
    liveDailyFlatAnchor = normalizeRateHistoryRow({
      date: todayDateStr(),
      updatedAt: localDayStartIso(),
      goldRatePerTola: tolaNpr,
      goldRatePerGram: gram,
      priceMode: 'api',
      flatAnchor: true
    });
  }
}

function buildDailyChartSeries() {
  const historyRows = rateHistoryForDisplay()
    .filter(isRowToday)
    .filter((row) => Number(row.goldRatePerTola) > 0)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));

  const fromRateHistory = () => {
    if (!historyRows.length) return [];
    const spread = spreadDailyChartTimestamps(historyRows.map((row, i) => ({
      ...rowToDailyChartPoint(row, { saved: true }),
      secondNum: i + 1,
      daySecond: daySecondFromIso(row.updatedAt),
      label: formatRateHistoryIntradayLabel(row.updatedAt)
    })));
    return attachRateHistoryComparisons(spread);
  };

  if (isLiveDailyApiMode() && liveDailySecondSeries.length) {
    return attachRateHistoryComparisons(liveDailySecondSeries.map((row, i) => ({
      ...rowToDailyChartPoint(row, {
        liveTick: i === liveDailySecondSeries.length - 1,
        saved: !!row.saved
      }),
      daySecond: row.daySecond ?? daySecondFromIso(row.updatedAt),
      secondNum: row.secondNum,
      label: format24HourClock(row.daySecond ?? daySecondFromIso(row.updatedAt))
    })));
  }

  return fromRateHistory();
}

function padSinglePointSeries(sorted, period) {
  if (sorted.length !== 1) return sorted;
  const only = sorted[0];
  if (period === 'daily') {
    const dayStart = localDayStartIso();
    const now = new Date().toISOString();
    return [
      {
        ...only,
        updatedAt: dayStart,
        bucket: dayStart,
        daySecond: 0,
        label: '00:00:00',
        chartTime: new Date(dayStart).getTime()
      },
      {
        ...only,
        updatedAt: now,
        bucket: now,
        daySecond: daySecondFromIso(now),
        label: formatRateHistoryIntradayLabel(now),
        chartTime: Date.now()
      }
    ];
  }
  return [{ ...only }, { ...only, chartPadEnd: true }];
}

function chartPointsFrom24Hour(sorted, pad, innerW, innerH, minV, span) {
  return sorted.map((row) => {
    const sec = row.daySecond ?? daySecondFromIso(row.updatedAt);
    const x = pad.left + (sec / DAY_SECONDS) * innerW;
    const y = pad.top + innerH - ((row.value - minV) / span) * innerH;
    return { x, y, row };
  });
}

function buildStepLinePath(points) {
  if (!points.length) return '';
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${points[i].x.toFixed(1)} V${points[i].y.toFixed(1)}`;
  }
  return d;
}

function buildStepAreaPath(points, baseY) {
  if (!points.length) return '';
  const line = buildStepLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x.toFixed(1)},${baseY} L${first.x.toFixed(1)},${baseY} Z`;
}

function buildStockLinePath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function build24HourXGrid(pad, innerW, innerH, h) {
  const hours = [0, 4, 8, 12, 16, 20, 24];
  return hours.map((hour) => {
    const x = pad.left + ((hour * 3600) / DAY_SECONDS) * innerW;
    const label = hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`;
    return `<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + innerH}" class="gp-vgrid"/>
      <text x="${x.toFixed(1)}" y="${h - 10}" class="gp-x-label" text-anchor="middle">${label}</text>`;
  }).join('');
}

function renderGoldPriceOrgHeader(sorted, mode, period) {
  const open = sorted[0];
  const latest = sorted[sorted.length - 1];
  const values = sorted.map((r) => r.value);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const sessionChange = Number((latest.value - open.value).toFixed(4));
  const sessionPct = open.value
    ? Number(((sessionChange / open.value) * 100).toFixed(2))
    : 0;
  const dir = stockSessionDirection(sorted);
  const sign = sessionChange > 0 ? '+' : '';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  const periodLabel = ratePeriodLabel(period);
  const isLive = period === 'daily' && isLiveDailyApiMode();
  const updatedLabel = isLive && liveDailyCurrentTick
    ? formatRateHistoryTableWhen(liveDailyCurrentTick)
    : formatRateHistoryTableWhen(latest);
  return `
    <div class="goldprice-chart-header">
      <div class="goldprice-header-main">
        <div class="goldprice-brand">
          <span class="goldprice-icon" aria-hidden="true">●</span>
          <div>
            <h4 class="goldprice-title">${t('goldSpotPrice')}</h4>
            <span class="goldprice-sub">${periodLabel} · ${rateHistoryModeLabel(mode)}</span>
          </div>
        </div>
        <div class="goldprice-quote is-${dir}">
          <span class="goldprice-value">${formatCurrencyAmount(latest.value)}</span>
          <span class="goldprice-unit">/ ${t('tolaUnit')}</span>
          <span class="goldprice-change">
            <span class="goldprice-arrow" aria-hidden="true">${arrow}</span>
            ${sign}${formatCurrencyAmount(sessionChange)}
            <span class="goldprice-pct">(${sign}${sessionPct}%)</span>
          </span>
        </div>
      </div>
      <div class="goldprice-stats">
        <span class="goldprice-stat"><em>${t('chartOpen')}</em> ${formatCurrencyAmount(open.value)}</span>
        <span class="goldprice-stat"><em>${t('chartHigh')}</em> ${formatCurrencyAmount(high)}</span>
        <span class="goldprice-stat"><em>${t('chartLow')}</em> ${formatCurrencyAmount(low)}</span>
        <span class="goldprice-stat goldprice-updated"><em>${t('chartUpdated')}</em> ${updatedLabel}</span>
      </div>
    </div>`;
}

function goldPriceOrgSvgDefs() {
  return `<defs>
    <linearGradient id="goldPriceArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(212,175,55,0.5)"/>
      <stop offset="45%" stop-color="rgba(201,162,39,0.18)"/>
      <stop offset="100%" stop-color="rgba(201,162,39,0)"/>
    </linearGradient>
    <filter id="goldPriceGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
}

function buildGoldPriceAreaPath(points, baseY, useStep) {
  if (points.length < 2) return '';
  const line = useStep ? buildStepLinePath(points) : buildStockLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x.toFixed(1)},${baseY} L${first.x.toFixed(1)},${baseY} Z`;
}

function buildGoldPriceLinePath(points, useStep) {
  return useStep ? buildStepLinePath(points) : buildStockLinePath(points);
}

function buildGoldPriceXGrid(pad, innerW, innerH, h, period) {
  if (period === 'daily' && isLiveDailyApiMode()) {
    return build24HourXGrid(pad, innerW, innerH, h);
  }
  return '';
}

function renderGoldPriceOrgChart(el, sorted, mode, period) {
  const isDailyLive = period === 'daily' && isLiveDailyApiMode();
  const useStep = isDailyLive;
  const w = 900;
  const h = isDailyLive ? 360 : 300;
  const pad = { top: 16, right: 78, bottom: 40, left: 12 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const values = sorted.map((r) => r.value);
  const { minV, maxV } = chartValueBounds(values);
  const span = maxV - minV || 1;
  const points = isDailyLive
    ? chartPointsFrom24Hour(sorted, pad, innerW, innerH, minV, span)
    : chartPointsFromSeries(sorted, pad, innerW, innerH, minV, span, period);
  const baseY = pad.top + innerH;
  const sessionDir = stockSessionDirection(sorted);
  const linePath = buildGoldPriceLinePath(points, useStep);
  const areaPath = buildGoldPriceAreaPath(points, baseY, useStep);
  const latest = sorted[sorted.length - 1];
  const lastPt = points[points.length - 1];

  const yTicks = 5;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = minV + (span * i) / yTicks;
    const y = pad.top + innerH - (i / yTicks) * innerH;
    return `<text x="${w - 8}" y="${y + 4}" class="gp-y-label" text-anchor="end">${formatChartAxisAmount(v)}</text>
      <line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" class="gp-hgrid"/>`;
  }).join('');

  let xLabels = buildGoldPriceXGrid(pad, innerW, innerH, h, period);
  if (!xLabels && points.length) {
    const n = points.length;
    const indices = n <= 5 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    xLabels = indices.map((i) => {
      const label = sorted[i].liveTick ? t('liveRateNow') : sorted[i].label;
      return `<text x="${points[i].x}" y="${h - 8}" class="gp-x-label" text-anchor="middle">${label}</text>`;
    }).join('');
  }

  const lastDot = lastPt
    ? `<g transform="translate(${lastPt.x.toFixed(1)},${lastPt.y.toFixed(1)})">
        <circle r="9" class="gp-live-pulse is-${sessionDir}"/>
        <circle r="5" class="gp-live-dot is-${sessionDir}">
          <title>${formatCurrencyAmount(latest.value)}</title>
        </circle>
      </g>`
    : '';

  const pointDots = points.map((p, i) => {
    const row = sorted[i];
    const label = `${row.label || row.date}: ${formatCurrencyAmount(row.value)}`;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="gp-point" tabindex="-1">
      <title>${label}</title>
    </circle>`;
  }).join('');

  el.innerHTML = `
    <div class="goldprice-chart">
      ${renderGoldPriceOrgHeader(sorted, mode, period)}
      <div class="goldprice-canvas-wrap">
        <svg class="goldprice-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t('goldRateChart')}" preserveAspectRatio="xMidYMid meet">
          ${goldPriceOrgSvgDefs()}
          <rect x="0" y="0" width="${w}" height="${h}" class="gp-bg"/>
          ${yLabels}
          ${xLabels}
          ${areaPath ? `<path d="${areaPath}" class="gp-area" fill="url(#goldPriceArea)"/>` : ''}
          ${linePath ? `<path d="${linePath}" class="gp-line" filter="url(#goldPriceGlow)"/>` : ''}
          ${pointDots}
          ${lastDot}
        </svg>
      </div>
      <div class="goldprice-footer">
        <span>${ratePeriodHint(period)}</span>
        <span class="goldprice-powered">${t('goldChartPowered')}</span>
      </div>
    </div>`;
  const liveBanner = document.getElementById('live-daily-rate-now');
  if (liveBanner) liveBanner.hidden = true;
  updateRateHistoryClearBtn();
}

function stockSessionDirection(sorted) {
  if (sorted.length < 2) return 'flat';
  const change = sorted[sorted.length - 1].value - sorted[0].value;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

function chartPointsFromSeries(sorted, pad, innerW, innerH, minV, span, period) {
  const useTimeAxis = period === 'daily';
  let minT = 0;
  let maxT = 1;
  if (useTimeAxis) {
    const times = sorted.map((row) => chartRowTimeMs(row));
    const dayStart = new Date(localDayStartIso()).getTime();
    const now = Date.now();
    minT = Math.min(...times, dayStart);
    maxT = Math.max(...times, now);
    if (maxT <= minT) maxT = minT + 60000;
  }
  const n = sorted.length;
  return sorted.map((row, i) => {
    const x = useTimeAxis
      ? pad.left + ((chartRowTimeMs(row) - minT) / (maxT - minT)) * innerW
      : pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = pad.top + innerH - ((row.value - minV) / span) * innerH;
    return { x, y, row };
  });
}

function updateLiveDailyTick(tolaNpr, gramNpr, priceMode) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  liveDailyCurrentTick = normalizeRateHistoryRow({
    date: todayDateStr(),
    updatedAt: new Date().toISOString(),
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2)),
    priceMode: mode,
    liveTick: true
  });
}

function renderLiveDailyRateNow() {
  const el = document.getElementById('live-daily-rate-now');
  if (!el) return;
  const chartEl = document.getElementById('rate-history-chart');
  const chartHasData = chartEl?.querySelector('.goldprice-chart');
  const show = activeView === 'settings'
    && currentRateHistoryPeriod() === 'daily'
    && isLiveDailyApiMode()
    && liveDailyCurrentTick
    && !chartHasData;
  if (!show) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'live-daily-rate-now goldprice-live-banner';
  const open = liveDailySecondSeries[0];
  const latest = liveDailyCurrentTick;
  const openVal = open ? nprToDisplay(open.goldRatePerTola) : nprToDisplay(latest.goldRatePerTola);
  const latestVal = nprToDisplay(latest.goldRatePerTola);
  const change = Number((latestVal - openVal).toFixed(4));
  const pct = openVal ? Number(((change / openVal) * 100).toFixed(2)) : 0;
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '+' : '';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  el.innerHTML = `
    <span class="live-daily-rate-badge">${t('liveRateNow')}</span>
    <strong class="live-daily-rate-price stock-live-price is-${dir}">${formatMoney(latest.goldRatePerTola)}/tola</strong>
    <span class="stock-chart-change is-${dir} stock-live-change">
      <span class="stock-chart-arrow" aria-hidden="true">${arrow}</span>
      ${sign}${formatCurrencyAmount(change)} (${sign}${pct}%)
    </span>
    <span class="live-daily-rate-time">${formatRateHistoryTableWhen(latest)}</span>
    <span class="live-daily-rate-hint">${t('liveRateNotSaved')}</span>`;
}

function todayRateHistoryRows() {
  if (currentRateHistoryPeriod() === 'daily') {
    return buildDailyChartSeries();
  }
  return rateHistoryForDisplay()
    .filter(isRowToday)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));
}

function hydrateLiveDailyReadingsFromCache() {
  liveDailyReadings = rateHistoryForDisplay()
    .filter(isRowToday)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));
}

function hydrateLiveDailySecondSeriesFromTicks(ticks) {
  liveDailySecondSeries = (ticks || []).map((row) => ({
    date: row.date || todayDateStr(),
    updatedAt: row.updatedAt,
    goldRatePerTola: row.goldRatePerTola,
    goldRatePerGram: row.goldRatePerGram,
    daySecond: row.daySecond ?? daySecondFromIso(row.updatedAt),
    secondNum: row.secondNum,
    value: nprToDisplay(row.goldRatePerTola),
    saved: !!row.saved,
    priceMode: row.priceMode === 'api' ? 'api' : 'manual'
  })).sort((a, b) => a.daySecond - b.daySecond || a.updatedAt.localeCompare(b.updatedAt));
  liveDailySecondSeq = liveDailySecondSeries.length
    ? Math.max(...liveDailySecondSeries.map((r) => r.secondNum || 0))
    : 0;
}

async function loadSharedGoldRates() {
  const mode = currentRateHistoryPriceMode();
  // The shared feed is the market (api) price only. A shop's own manual
  // rate history comes with /api/settings and is private to the shop.
  if (mode !== 'api') return;
  try {
    const payload = await api(
      `/api/shared/gold-rates?date=${encodeURIComponent(todayDateStr())}&priceMode=${encodeURIComponent(mode)}`
    );
    rateHistoryCache = (payload.history || []).map(normalizeRateHistoryRow);
    hydrateLiveDailyReadingsFromCache();
    hydrateLiveDailySecondSeriesFromTicks(payload.ticks || []);
  } catch (_) { /* background load */ }
}

const SHARED_TICK_FLUSH_MS = 10000;
let sharedTickQueue = new Map();
let sharedTickFlushTimer = null;

function sharedTickKey(row) {
  const mode = row.priceMode === 'api' ? 'api' : 'manual';
  return `${row.date}|${mode}|${row.daySecond}`;
}

function rowToSharedTickPayload(row) {
  return {
    date: row.date || todayDateStr(),
    updatedAt: row.updatedAt,
    daySecond: row.daySecond ?? daySecondFromIso(row.updatedAt),
    secondNum: row.secondNum,
    goldRatePerTola: row.goldRatePerTola,
    goldRatePerGram: row.goldRatePerGram,
    priceMode: row.priceMode || (isLiveDailyApiMode() ? 'api' : 'manual'),
    saved: !!row.saved
  };
}

function queueSharedGraphTick(row) {
  if (!row?.goldRatePerTola) return;
  sharedTickQueue.set(sharedTickKey(row), rowToSharedTickPayload(row));
  if (row.saved) {
    flushSharedGraphTicks();
    return;
  }
  scheduleSharedGraphTickFlush();
}

function scheduleSharedGraphTickFlush() {
  if (sharedTickFlushTimer) return;
  sharedTickFlushTimer = setTimeout(() => {
    sharedTickFlushTimer = null;
    flushSharedGraphTicks();
  }, SHARED_TICK_FLUSH_MS);
}

async function flushSharedGraphTicks() {
  if (!sharedTickQueue.size) return;
  // Only the market feed is shared; a shop's manual readings stay local.
  if (!isLiveDailyApiMode()) { sharedTickQueue.clear(); return; }
  const ticks = [...sharedTickQueue.values()];
  sharedTickQueue.clear();
  if (sharedTickFlushTimer) {
    clearTimeout(sharedTickFlushTimer);
    sharedTickFlushTimer = null;
  }
  try {
    await api('/api/shared/gold-rates/ticks', {
      method: 'POST',
      body: JSON.stringify({ ticks })
    });
  } catch (_) { /* background save */ }
}

function sameGoldRateReading(a, tolaNpr, gramNpr) {
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  return Number(a.goldRatePerTola) === Number(tolaNpr)
    && Number(a.goldRatePerGram) === Number(gram);
}

function pushLiveDailyReading(tolaNpr, gramNpr, priceMode) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  if (!tolaNpr || tolaNpr <= 0) return false;
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  const last = liveDailyReadings[liveDailyReadings.length - 1];
  if (last && sameGoldRateReading(last, tolaNpr, gram)) return false;
  const updatedAt = new Date(nextChartTimeAfter(last, DAILY_CHART_MIN_GAP_MS)).toISOString();
  const entry = normalizeRateHistoryRow({
    date: todayDateStr(),
    updatedAt,
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gram,
    priceMode: mode
  });
  liveDailyReadings.push(entry);
  if (liveDailyReadings.length > 500) liveDailyReadings.shift();
  return true;
}

function updateMetalRateHeaderFromLive(live) {
  const goldEl = document.getElementById('metal-rate-gold');
  const silverEl = document.getElementById('metal-rate-silver');
  const bodyEl = document.getElementById('metal-rates-body');
  const rates = liveMetalRatesToNpr(live);
  if (bodyEl) bodyEl.hidden = true;
  if (goldEl) {
    goldEl.hidden = false;
    goldEl.textContent = formatLiveMetalRateLine('Gold', rates.goldPerTola, rates.goldPerGram);
  }
  if (silverEl) {
    silverEl.hidden = false;
    silverEl.textContent = formatLiveMetalRateLine('Silver', rates.silverPerTola, rates.silverPerGram);
  }
}

async function captureLiveDailyRate() {
  const mode = effectivePriceMode() === 'api' ? 'api' : 'manual';
  let tolaNpr = goldRateCache;
  let gramNpr = Number((tolaNpr / TOLA_GRAMS).toFixed(2));

  // Nothing to record until the shop has entered a rate in Settings.
  if (tolaNpr <= 0) return;

  const added = pushLiveDailyReading(tolaNpr, gramNpr, mode);
  if (added) {
    persistDailyGoldRateSnapshot(mode, { goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr });
  }

  if (activeView === 'settings' && currentRateHistoryPeriod() === 'daily') {
    renderLiveDailyRateNow();
    renderRateHistoryChart();
    renderRateHistoryTable();
  }
}

function currentRateHistoryPeriod() {
  const active = document.querySelector('.rate-history-period [data-rate-period].is-active');
  const period = active?.dataset.ratePeriod;
  if (period === 'weekly' || period === 'monthly' || period === 'yearly') return period;
  return 'daily';
}

function ratePeriodLabel(period) {
  const keys = {
    daily: 'ratePeriodDaily',
    weekly: 'ratePeriodWeekly',
    monthly: 'ratePeriodMonthly',
    yearly: 'ratePeriodYearly'
  };
  return t(keys[period] || keys.daily);
}

function ratePeriodHint(period) {
  const keys = {
    daily: 'ratePeriodDailyHint',
    weekly: 'ratePeriodWeeklyHint',
    monthly: 'ratePeriodMonthlyHint',
    yearly: 'ratePeriodYearlyHint'
  };
  return t(keys[period] || keys.daily);
}

function rateCompareVsPrevLabel(period) {
  const keys = {
    daily: 'rateCompareVsPrevReading',
    weekly: 'rateCompareVsPrevWeek',
    monthly: 'rateCompareVsPrevMonth',
    yearly: 'rateCompareVsPrevMonth'
  };
  return t(keys[period] || keys.daily);
}

function getRateHistoryBucketKey(dateStr, period) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (period === 'monthly' || period === 'yearly') {
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  if (period === 'weekly') {
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(dt);
    monday.setDate(diff);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  }
  return dateStr;
}

function formatRateHistoryBucketLabel(bucket, period) {
  if (period === 'daily') return formatRateHistoryDate({ date: bucket });
  if (period === 'monthly' || period === 'yearly') {
    const [y, m] = bucket.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  const [y, m, d] = bucket.split('-').map(Number);
  const weekStart = new Date(y, m - 1, d);
  return weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function attachRateHistoryComparisons(rows) {
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const change = prev ? Number((row.value - prev.value).toFixed(4)) : null;
    const changePct = prev && prev.value
      ? Number(((change / prev.value) * 100).toFixed(2))
      : null;
    return { ...row, change, changePct };
  });
}

function formatRateHistoryChange(row, period) {
  if (row.change == null) return '';
  const sign = row.change > 0 ? '+' : '';
  const amount = formatCurrencyAmount(row.change);
  const pct = row.changePct != null ? ` (${sign}${row.changePct}%)` : '';
  return `${sign}${amount}${pct} ${rateCompareVsPrevLabel(period)}`;
}

function rateHistoryChangeClass(change) {
  if (change == null) return '';
  if (change > 0) return 'is-up';
  if (change < 0) return 'is-down';
  return 'is-flat';
}

function aggregateRateHistoryForChart(rows, period) {
  const sorted = [...rows]
    .map((row) => ({
      date: row.date || String(row.updatedAt || '').slice(0, 10),
      updatedAt: row.updatedAt || null,
      goldRatePerTola: row.goldRatePerTola,
      value: nprToDisplay(row.goldRatePerTola)
    }))
    .filter((row) => row.date && row.value > 0)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));

  let source = sorted;
  if (period === 'yearly') {
    const year = new Date().getFullYear();
    source = sorted.filter((row) => Number(row.date.slice(0, 4)) === year);
  }

  if (period === 'daily') {
    const intraday = source.filter((row) => isRowToday(row));
    return attachRateHistoryComparisons(intraday.map((row) => ({
      ...row,
      bucket: row.updatedAt || row.date,
      label: formatRateHistoryIntradayLabel(row.updatedAt)
    })));
  }

  // Weekly / Monthly are practical shop views: one closing rate per day for
  // the last 7 / 30 days — not calendar buckets (which collapse a whole month
  // of movement into a single point and draw a meaningless straight line).
  if (period === 'weekly' || period === 'monthly') {
    const days = period === 'weekly' ? 7 : 30;
    const cutoff = localDateStr(new Date(Date.now() - (days - 1) * 86400000));
    const closes = new Map();
    source.forEach((row) => { if (row.date >= cutoff) closes.set(row.date, row); });
    const perDay = [...closes.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ ...row, bucket: row.date, label: formatGoldTrendDayLabel(row.date) }));
    return attachRateHistoryComparisons(perDay);
  }

  const bucketPeriod = period === 'yearly' ? 'yearly' : period;
  const buckets = new Map();
  source.forEach((row) => {
    const bucket = getRateHistoryBucketKey(row.date, bucketPeriod);
    const sortKey = row.updatedAt || row.date;
    const existing = buckets.get(bucket);
    if (!existing || sortKey > (existing.updatedAt || existing.date)) {
      buckets.set(bucket, {
        ...row,
        bucket,
        label: formatRateHistoryBucketLabel(bucket, bucketPeriod)
      });
    }
  });
  return attachRateHistoryComparisons(
    [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
  );
}

// The shop's own rate is the only rate. Live/API metal pricing was removed:
// gold and silver always come from what is saved in Settings, so the till, the
// dashboard and every price preview agree with the sheet on the wall.
const PRICE_MODE = 'manual';

function currentRateHistoryPriceMode() {
  return PRICE_MODE;
}

function effectivePriceMode() {
  return PRICE_MODE;
}

function readManualRatesFromForm() {
  const priceForm = document.getElementById('settings-form');
  if (!priceForm) {
    return {
      goldRatePerTola: goldRateCache,
      goldRatePerGram: Number((goldRateCache / TOLA_GRAMS).toFixed(2)),
      goldBuyRatePerTola: goldBuyRateCache,
      goldBuyRatePerGram: Number((goldBuyRateCache / TOLA_GRAMS).toFixed(2)),
      silverRatePerTola: silverRateCache,
      silverRatePerGram: Number((silverRateCache / TOLA_GRAMS).toFixed(2))
    };
  }
  const goldRatePerTola = parseTolaRateInput(priceForm.goldRatePerTola?.value)
    || parseTolaFromGramInput(priceForm.goldRatePerGram?.value)
    || goldRateCache;
  const goldBuyRatePerTola = parseTolaRateInput(priceForm.goldBuyRatePerTola?.value)
    || parseTolaFromGramInput(priceForm.goldBuyRatePerGram?.value)
    || goldBuyRateCache;
  const silverRatePerTola = parseTolaRateInput(priceForm.silverRatePerTola?.value)
    || parseTolaFromGramInput(priceForm.silverRatePerGram?.value)
    || silverRateCache;
  return {
    goldRatePerTola,
    goldRatePerGram: Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    goldBuyRatePerTola,
    goldBuyRatePerGram: Number((goldBuyRatePerTola / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola,
    silverRatePerGram: Number((silverRatePerTola / TOLA_GRAMS).toFixed(2))
  };
}

function resolveManualMetalRates(settings = null) {
  const fromForm = readManualRatesFromForm();
  const goldRatePerTola = Number(settings?.goldRatePerTola ?? fromForm.goldRatePerTola) || 0;
  const silverRatePerTola = Number(settings?.silverRatePerTola ?? fromForm.silverRatePerTola) || 0;
  // Number(undefined) is NaN, and ?? only catches null/undefined — so the
  // fallback has to be chosen BEFORE the value is converted, or the sidebar
  // prints "NaN/g" whenever the caller doesn't pass a per-gram rate.
  const goldPerGram = Number(settings?.goldRatePerGram);
  const silverPerGram = Number(settings?.silverRatePerGram);
  return {
    goldRatePerTola,
    goldRatePerGram: Number.isFinite(goldPerGram) && goldPerGram > 0
      ? goldPerGram
      : Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola,
    silverRatePerGram: Number.isFinite(silverPerGram) && silverPerGram > 0
      ? silverPerGram
      : Number((silverRatePerTola / TOLA_GRAMS).toFixed(2))
  };
}

function applyManualRatesToApp(metal) {
  goldRateCache = metal.goldRatePerTola;
  silverRateCache = metal.silverRatePerTola;
  const goldEl = document.getElementById('metal-rate-gold');
  const silverEl = document.getElementById('metal-rate-silver');
  const bodyEl = document.getElementById('metal-rates-body');
  // No rate saved yet → point the shop at Settings instead of showing "0/tola".
  const hasGold = Number(metal.goldRatePerTola) > 0;
  const hasSilver = Number(metal.silverRatePerTola) > 0;
  if (bodyEl) bodyEl.hidden = hasGold || hasSilver;
  if (goldEl) {
    goldEl.hidden = !hasGold;
    goldEl.textContent =
      `Gold: ${formatMoney(metal.goldRatePerTola)}/tola · ${formatMoney(metal.goldRatePerGram)}/g`;
  }
  if (silverEl) {
    silverEl.hidden = !hasSilver;
    silverEl.textContent =
      `Silver: ${formatMoney(metal.silverRatePerTola)}/tola · ${formatMoney(metal.silverRatePerGram)}/g`;
  }
}

function syncManualRatesFromForm() {
  if (effectivePriceMode() !== 'manual') return;
  applyManualRatesToApp(readManualRatesFromForm());
  updateGoldCalculator();
  updateOrderTotalPreview();
  refreshDisplayPrices();
}

function rateHistoryForDisplay() {
  const mode = currentRateHistoryPriceMode();
  return rateHistoryCache
    .map(normalizeRateHistoryRow)
    .filter((row) => row.priceMode === mode);
}

function rateHistoryModeLabel(mode) {
  return mode === 'api' ? t('useLiveApi') : t('useManualPrice');
}

function updateRateHistoryClearBtn() {
  const btn = document.getElementById('clear-rate-history-btn');
  if (!btn) return;
  const hasData = currentRateHistoryPeriod() === 'daily'
    ? (isLiveDailyApiMode() ? liveDailySecondSeries.length > 0 : todayRateHistoryRows().length > 0)
    : rateHistoryForDisplay().length > 0;
  btn.hidden = !hasData;
  btn.title = t('clearRateHistory');
  btn.setAttribute('aria-label', t('clearRateHistory'));
}

const RATE_CHART_Y_MIN = 1300;
const RATE_CHART_Y_MAX = 1800;
/** Minimum Y span so a 0.1 move is visible on the chart (~3px at typical height). */
const RATE_CHART_MIN_SPAN = 8;
const RATE_CHART_FULL_BAND_RANGE = 120;

function formatChartAxisAmount(amount) {
  const n = Number(amount) || 0;
  if (n >= RATE_CHART_Y_MIN && n <= RATE_CHART_Y_MAX) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return formatCurrencyAmount(n);
}

function clampRateChartBounds(minV, maxV) {
  let min = minV;
  let max = maxV;
  if (min < RATE_CHART_Y_MIN) {
    max += RATE_CHART_Y_MIN - min;
    min = RATE_CHART_Y_MIN;
  }
  if (max > RATE_CHART_Y_MAX) {
    min -= max - RATE_CHART_Y_MAX;
    max = RATE_CHART_Y_MAX;
  }
  min = Math.max(RATE_CHART_Y_MIN, min);
  max = Math.min(RATE_CHART_Y_MAX, max);
  if (max - min < RATE_CHART_MIN_SPAN) {
    if (max >= RATE_CHART_Y_MAX) {
      min = RATE_CHART_Y_MAX - RATE_CHART_MIN_SPAN;
    } else {
      max = Math.min(RATE_CHART_Y_MIN + RATE_CHART_MIN_SPAN, RATE_CHART_Y_MAX);
    }
  }
  return { minV: min, maxV: max };
}

function chartValueBounds(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range = dataMax - dataMin;
  const dataInBand = dataMax >= RATE_CHART_Y_MIN && dataMin <= RATE_CHART_Y_MAX;

  if (!dataInBand) {
    const padAmt = Math.max(range * 0.25, range <= 0 ? Math.max(Math.abs(dataMin) * 0.001, 0.5) : 0.5);
    if (range <= 0) {
      return { minV: dataMin - padAmt, maxV: dataMax + padAmt };
    }
    return { minV: dataMin - padAmt, maxV: dataMax + padAmt };
  }

  if (range >= RATE_CHART_FULL_BAND_RANGE) {
    return { minV: RATE_CHART_Y_MIN, maxV: RATE_CHART_Y_MAX };
  }

  if (range <= 0) {
    return clampRateChartBounds(
      dataMin - RATE_CHART_MIN_SPAN / 2,
      dataMax + RATE_CHART_MIN_SPAN / 2
    );
  }

  const padAmt = Math.max(range * 0.2, 0.5);
  let minV = dataMin - padAmt;
  let maxV = dataMax + padAmt;
  if (maxV - minV < RATE_CHART_MIN_SPAN) {
    const mid = (dataMin + dataMax) / 2;
    minV = mid - RATE_CHART_MIN_SPAN / 2;
    maxV = mid + RATE_CHART_MIN_SPAN / 2;
  }
  return clampRateChartBounds(minV, maxV);
}

function formatGoldTrendDayLabel(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatGoldTrendYLabel(value) {
  if (value >= 100000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * Clean, practical gold-rate trend chart for the 7-day / 30-day / 1-year
 * views: single gold line + soft area, labelled y gridlines, real date
 * labels, a dot on today's rate, and a hover crosshair with the exact
 * rate and day-to-day change.
 */
function renderGoldTrendChart(el, sorted, mode, period) {
  const W = 760, H = 300;
  const pad = { t: 18, r: 66, b: 34, l: 12 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const values = sorted.map((r) => r.value);
  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  const span0 = maxV - minV;
  const padV = span0 > 0 ? span0 * 0.12 : Math.max(1, maxV * 0.01);
  minV -= padV; maxV += padV;
  const span = maxV - minV;

  const px = (i) => pad.l + (sorted.length === 1 ? innerW / 2 : (i / (sorted.length - 1)) * innerW);
  const py = (v) => pad.t + innerH - ((v - minV) / span) * innerH;

  const points = sorted.map((r, i) => ({ x: px(i), y: py(r.value) }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;

  // 4 horizontal gridlines with rate labels on the right.
  const gridRows = [...Array(4)].map((_, i) => {
    const v = minV + (span * i) / 3;
    const y = py(v);
    return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + innerW}" y2="${y.toFixed(1)}" class="gtrend-grid" />
      <text x="${pad.l + innerW + 8}" y="${(y + 4).toFixed(1)}" class="gtrend-ylabel">${formatGoldTrendYLabel(v)}</text>`;
  }).join('');

  // Up to 6 evenly-spaced date labels, always including first and last.
  const labelCount = Math.min(6, sorted.length);
  const labelIdx = new Set([...Array(labelCount)].map((_, i) => Math.round((i * (sorted.length - 1)) / Math.max(1, labelCount - 1))));
  const xLabels = sorted.map((r, i) => {
    if (!labelIdx.has(i)) return '';
    const anchor = i === 0 ? 'start' : i === sorted.length - 1 ? 'end' : 'middle';
    return `<text x="${px(i).toFixed(1)}" y="${H - 10}" text-anchor="${anchor}" class="gtrend-xlabel">${r.label || r.date}</text>`;
  }).join('');

  const last = points[points.length - 1];

  el.innerHTML = `
    ${renderGoldPriceOrgHeader(sorted, mode, period)}
    <div class="gtrend-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="gtrend-svg" preserveAspectRatio="none" role="img" aria-label="${t('goldSpotPrice')}">
        <defs>
          <linearGradient id="gtrend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--gold, #b45309)" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="var(--gold, #b45309)" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${gridRows}
        <path d="${area}" fill="url(#gtrend-fill)"/>
        <path d="${line}" fill="none" stroke="var(--gold, #b45309)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line id="gtrend-cross" x1="0" y1="${pad.t}" x2="0" y2="${pad.t + innerH}" class="gtrend-cross" hidden/>
        <circle id="gtrend-hoverdot" r="4.5" class="gtrend-hoverdot" hidden/>
        <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5" class="gtrend-lastdot"/>
        ${xLabels}
      </svg>
      <div id="gtrend-tip" class="gtrend-tip" hidden></div>
    </div>`;

  // Hover: snap to the nearest day, show crosshair + exact rate + change.
  const svg = el.querySelector('.gtrend-svg');
  const tip = el.querySelector('#gtrend-tip');
  const cross = el.querySelector('#gtrend-cross');
  const hoverDot = el.querySelector('#gtrend-hoverdot');
  if (!svg || !tip) return;
  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    let idx = 0, best = Infinity;
    points.forEach((p, i) => { const d = Math.abs(p.x - relX); if (d < best) { best = d; idx = i; } });
    const row = sorted[idx];
    const p = points[idx];
    cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.hidden = false;
    hoverDot.setAttribute('cx', p.x); hoverDot.setAttribute('cy', p.y); hoverDot.hidden = false;
    const changeTxt = row.change != null
      ? ` · ${row.change > 0 ? '▲ +' : row.change < 0 ? '▼ ' : ''}${formatCurrencyAmount(row.change)} (${row.changePct > 0 ? '+' : ''}${row.changePct}%)`
      : '';
    tip.innerHTML = `<strong>${row.label || row.date}</strong> — ${formatCurrencyAmount(row.value)}/${t('tolaUnit')}<span class="gtrend-tip-change${row.change > 0 ? ' is-up' : row.change < 0 ? ' is-down' : ''}">${changeTxt}</span>`;
    tip.hidden = false;
    const leftPct = (p.x / W) * 100;
    tip.style.left = `${Math.min(78, Math.max(6, leftPct))}%`;
  });
  svg.addEventListener('mouseleave', () => {
    tip.hidden = true; cross.hidden = true; hoverDot.hidden = true;
  });
}

function renderRateHistoryChart() {
  const el = document.getElementById('rate-history-chart');
  if (!el) return;
  const periodList = document.querySelector('.rate-history-period');
  if (periodList) periodList.setAttribute('aria-label', t('ratePeriodAria'));
  const mode = currentRateHistoryPriceMode();
  const period = currentRateHistoryPeriod();
  const todayRows = period === 'daily'
    ? todaySavedRateRows()
    : rateHistoryForDisplay().sort((a, b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date));
  let sorted = period === 'daily'
    ? buildDailyChartSeries()
    : aggregateRateHistoryForChart(rateHistoryForDisplay(), period);
  if (sorted.length === 1) sorted = padSinglePointSeries(sorted, period);

  if (!sorted.length) {
    const emptyMsg = period === 'daily'
      ? (todayRows.length ? t('rateIntradayCollecting') : t('noRateHistoryChartDaily'))
      : t('noRateHistoryChart');
    el.innerHTML = `<p class="empty rate-chart-empty">${emptyMsg} (${ratePeriodLabel(period)} · ${rateHistoryModeLabel(mode)})</p>`;
    if (period === 'daily' && isLiveDailyApiMode()) {
      renderLiveDailyRateNow();
    }
    updateRateHistoryClearBtn();
    return;
  }

  // Daily keeps the live intraday ticker; the longer views use the clean
  // day-by-day trend chart.
  if (period === 'daily') renderGoldPriceOrgChart(el, sorted, mode, period);
  else renderGoldTrendChart(el, sorted, mode, period);
}

function renderRateHistoryTable() {
  /* Chart-only: rate values shown in graph header and tooltips, not in a table. */
}

async function clearRateHistoryForCurrentMode() {
  const mode = currentRateHistoryPriceMode();
  if (!rateHistoryForDisplay().length && !liveDailyReadings.length) return;
  if (!confirm(t('clearRateHistoryConfirm'))) return;
  try {
    const payload = await api(`/api/settings/rate-history?priceMode=${encodeURIComponent(mode)}`, {
      method: 'DELETE'
    });
    rateHistoryCache = (payload.rateHistory || []).map(normalizeRateHistoryRow);
    liveDailyReadings = liveDailyReadings.filter((row) => row.priceMode !== mode);
    resetLiveDailySecondSeries();
    liveDailyFlatAnchor = null;
    renderRateHistoryChart();
    renderRateHistoryTable();
    toast(t('clearRateHistoryDone'));
  } catch (err) {
    toast(err.message);
  }
}

async function persistDailyGoldRateSnapshot(priceMode = settingsPriceMode, rates = null) {
  const tola = Number(rates?.goldRatePerTola ?? goldRateCache);
  if (!tola || tola <= 0) return false;
  const gram = Number(rates?.goldRatePerGram)
    || Number((tola / TOLA_GRAMS).toFixed(2));
  const mode = priceMode === 'api' ? 'api' : 'manual';
  try {
    const payload = await api('/api/settings/daily-gold-rate', {
      method: 'POST',
      body: JSON.stringify({
        goldRatePerTola: tola,
        goldRatePerGram: gram,
        priceMode: mode,
        localDate: todayDateStr()
      })
    });
    if (Array.isArray(payload.rateHistory)) {
      rateHistoryCache = payload.rateHistory.map(normalizeRateHistoryRow);
      hydrateLiveDailyReadingsFromCache();
    }
    return Boolean(payload.changed);
  } catch (_) { /* background save */ }
  return false;
}

function hasTodayRateReading(priceMode) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  const today = todayDateStr();
  return rateHistoryForDisplay().some((row) =>
    row.priceMode === mode && String(row.date || '').slice(0, 10) === today);
}

async function ensureTodayGoldRateInDatabase() {
  const mode = effectivePriceMode() === 'api' ? 'api' : 'manual';
  if (goldRateCache <= 0 || hasTodayRateReading(mode)) return;
  await persistDailyGoldRateSnapshot(mode);
}

function stopMetalRatePolling() {
  if (metalRatePollTimer) {
    clearInterval(metalRatePollTimer);
    metalRatePollTimer = null;
  }
  flushSharedGraphTicks();
}

function syncMetalRatePolling() {
  stopMetalRatePolling();
  if (activeView !== 'settings' || currentRateHistoryPeriod() !== 'daily') return;
  if (!isLiveDailyApiMode()) return;
  loadSharedGoldRates().then(() => {
    renderRateHistoryChart();
    renderRateHistoryTable();
    captureLiveDailyRate().catch(() => {});
  }).catch(() => {
    captureLiveDailyRate().catch(() => {});
  });
  metalRatePollTimer = setInterval(() => {
    captureLiveDailyRate().catch(() => {});
  }, METAL_RATE_POLL_MS);
}

// ── keeping the rate in step with the phone ──────────────────────────────
// The server holds one rate for the shop and whichever side saved last wins.
// This page loaded its copy once; the phone may have saved since. So the rate
// is re-read from the server whenever this tab comes back into view and once
// a minute while it stays open, and applied only when it actually changed —
// a silent no-op the rest of the time.
const RATE_SYNC_MS = 60 * 1000;
let rateSyncTimer = null;
let rateSyncInFlight = false;

async function syncRatesFromServer() {
  if (rateSyncInFlight || document.hidden) return;
  if (typeof isSignedInSync === 'function' && !isSignedInSync()) return;
  rateSyncInFlight = true;
  try {
    const settings = await api('/api/settings');
    const gold = Number(settings.goldRatePerTola) || 0;
    const goldBuy = Number(settings.goldBuyRatePerTola) || 0;
    const silver = Number(settings.silverRatePerTola) || 0;
    const changed = gold !== goldRateCache || goldBuy !== goldBuyRateCache || silver !== silverRateCache;
    if (!changed) return;
    goldRateCache = gold;
    goldBuyRateCache = goldBuy;
    silverRateCache = silver;
    settingsCache.goldRatePerTola = gold;
    settingsCache.goldBuyRatePerTola = goldBuy;
    settingsCache.silverRatePerTola = silver;
    if (Array.isArray(settings.rateHistory)) {
      rateHistoryCache = settings.rateHistory.map(normalizeRateHistoryRow);
      renderRateHistoryChart();
      renderRateHistoryTable();
    }
    refreshMetalPriceFields();
    await updateMetalRates(settings);
    refreshDisplayPrices();
    if (typeof toast === 'function') toast(t('rateUpdatedElsewhere'));
  } catch (err) {
    // Nothing to do — the next focus or tick tries again.
  } finally {
    rateSyncInFlight = false;
  }
}

function startRateSync() {
  if (rateSyncTimer) return;
  rateSyncTimer = setInterval(() => { syncRatesFromServer().catch(() => {}); }, RATE_SYNC_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncRatesFromServer().catch(() => {});
  });
  window.addEventListener('focus', () => { syncRatesFromServer().catch(() => {}); });
}

async function seedTodayRateReading() {
  await captureLiveDailyRate();
}

async function refreshAfterCurrencyChange(prevCurrency) {
  refreshCurrencyLabels();
  const metal = resolveManualMetalRates(settingsCache);
  applyManualRatesToApp(metal);
  refreshMetalPriceFields();
  await updateMetalRates(metal);
  if (prevCurrency && prevCurrency !== displayCurrency) {
    refreshGoldCalcForCurrency(prevCurrency);
  }
  updateGoldCalcRateLabel();
  updateGoldCalculator();
  refreshDisplayPrices();
  if (activeView === 'reports') {
    await loadReports().catch((err) => toast(err.message));
  }
}
function refreshCurrencyLabels() {
  document.querySelectorAll('[data-currency-field]').forEach((el) => {
    const key = el.dataset.currencyField;
    if (key) el.textContent = labelWithCurrency(key);
  });
  const metalTitle = document.querySelector('.metal-rates h3');
  if (metalTitle) metalTitle.textContent = `${t('liveMetalRates')} (${currencyCode()})`;
  updateOrderTotalPreview();
  updateCustomItemPricePreview();
}

function formatRateInput(npr) {
  const amount = nprToDisplay(npr);
  return currencyCode() === 'NPR' ? Math.round(amount) : Number(amount.toFixed(2));
}

function parseRateInput(value) {
  return displayToNpr(Number(value) || 0);
}

function formatGramRateFromTola(tolaNpr) {
  return formatRateInput((tolaNpr || 0) / TOLA_GRAMS);
}

function formatTolaRateInput(tolaNpr) {
  return formatRateInput(tolaNpr || 0);
}

function parseTolaRateInput(value) {
  return parseRateInput(value);
}

function parseTolaFromGramInput(gramValue) {
  return Number((parseRateInput(gramValue) * TOLA_GRAMS).toFixed(2));
}

let metalRateSyncLock = false;

function syncSettingsGoldRateFromGram() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="goldRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="goldRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaFromGramInput(gramInput.value);
  tolaInput.value = formatTolaRateInput(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsGoldRateFromTola() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="goldRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="goldRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaRateInput(tolaInput.value);
  gramInput.value = formatGramRateFromTola(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsGoldBuyRateFromGram() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="goldBuyRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="goldBuyRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaFromGramInput(gramInput.value);
  tolaInput.value = formatTolaRateInput(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsGoldBuyRateFromTola() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="goldBuyRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="goldBuyRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaRateInput(tolaInput.value);
  gramInput.value = formatGramRateFromTola(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsSilverRateFromGram() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="silverRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="silverRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaFromGramInput(gramInput.value);
  tolaInput.value = formatTolaRateInput(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsSilverRateFromTola() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="silverRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="silverRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaRateInput(tolaInput.value);
  gramInput.value = formatGramRateFromTola(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function refreshMetalPriceFields() {
  const priceForm = document.getElementById('settings-form');
  if (!priceForm) return;
  // The caches ARE the shop's rate: loadSettings fills them from the server,
  // and a save fills them from what was just sent. The form must follow them,
  // never the other way round — otherwise a rate saved on the phone can never
  // replace the number this page loaded earlier, and that stale number is
  // what the next save would send back to the server.
  const metal = {
    goldRatePerTola: goldRateCache,
    goldBuyRatePerTola: goldBuyRateCache,
    silverRatePerTola: silverRateCache
  };
  // A field the shopkeeper is typing in is theirs until they leave it.
  const active = document.activeElement;
  const isEditing = (field) => field && active === field;
  const goldGramField = priceForm.goldRatePerGram;
  const goldTolaField = priceForm.goldRatePerTola;
  const goldBuyGramField = priceForm.goldBuyRatePerGram;
  const goldBuyTolaField = priceForm.goldBuyRatePerTola;
  const silverGramField = priceForm.silverRatePerGram;
  const silverTolaField = priceForm.silverRatePerTola;
  const rateStep = currencyCode() === 'NPR' ? '1' : '0.01';
  if (goldGramField) {
    if (!isEditing(goldGramField)) goldGramField.value = formatGramRateFromTola(metal.goldRatePerTola);
    goldGramField.step = rateStep;
  }
  if (goldTolaField) {
    if (!isEditing(goldTolaField)) goldTolaField.value = formatTolaRateInput(metal.goldRatePerTola);
    goldTolaField.step = rateStep;
  }
  if (goldBuyGramField) {
    if (!isEditing(goldBuyGramField)) goldBuyGramField.value = formatGramRateFromTola(metal.goldBuyRatePerTola);
    goldBuyGramField.step = rateStep;
  }
  if (goldBuyTolaField) {
    if (!isEditing(goldBuyTolaField)) goldBuyTolaField.value = formatTolaRateInput(metal.goldBuyRatePerTola);
    goldBuyTolaField.step = rateStep;
  }
  if (silverGramField) {
    if (!isEditing(silverGramField)) silverGramField.value = formatGramRateFromTola(metal.silverRatePerTola);
    silverGramField.step = '0.01';
  }
  if (silverTolaField) {
    if (!isEditing(silverTolaField)) silverTolaField.value = formatTolaRateInput(metal.silverRatePerTola);
    silverTolaField.step = rateStep;
  }
  refreshCurrencyLabels();
}

function sortIcon() {
  return '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>';
}

function cartIcon() {
  return '<svg class="order-cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
}

function shopLogoHtml(className = 'shop-logo') {
  const alt = settingsCache.shopName || 'Suvarnapasal';
  return `<img src="logo.svg" class="${className}" width="88" height="88" alt="${escapeHtml(alt)}" />`;
}

function inventoryTableHead() {
  return `<thead><tr>
    <th class="sortable">${t('name')}${sortIcon()}</th>
    <th>${t('purity')}</th>
    <th>Weight</th>
    <th>Rate</th>
    <th>Amount</th>
    <th>Making</th>
    <th>Stone</th>
    <th class="sortable">Total price${sortIcon()}</th>
    <th>${t('options')}</th>
  </tr></thead>`;
}

function ordersTableHead() {
  return `<thead><tr>
    <th><input type="checkbox" aria-label="Select all" /></th>
    <th class="sortable">Order / Date${sortIcon()}</th>
    <th class="sortable">Due Date${sortIcon()}</th>
    <th>${t('customer')}</th>
    <th>${t('itemsCol')}</th>
    <th>Karigar</th>
    <th>Payment / Gold</th>
    <th class="sortable">${t('totalCol')}${sortIcon()}</th>
    <th>${t('status')}</th>
    <th>${t('options')}</th>
  </tr></thead>`;
}

function ordersEmptyTable() {
  return `<table class="data-table">${ordersTableHead()}<tbody><tr class="empty-row"><td colspan="10">${t('noResults')}</td></tr></tbody></table>`;
}

const ORDER_STATUS_RANK = {
  pending: 0,
  confirmed: 1,
  progress: 2,
  ready: 3,
  completed: 4,
  cancelled: 5
};

const ORDER_GROUPS = [
  { id: 'new', labelKey: 'orderNew', statuses: ['pending', 'confirmed'] },
  { id: 'progress', labelKey: 'orderProgress', statuses: ['progress', 'ready'] },
  { id: 'completed', labelKey: 'orderCompleted', statuses: ['completed'] }
];

function orderGroupIdForStatus(status) {
  return ORDER_GROUPS.find((g) => g.statuses.includes(status))?.id || null;
}

function orderGroupTargetStatus(groupId) {
  if (groupId === 'new') return 'pending';
  if (groupId === 'progress') return 'progress';
  if (groupId === 'completed') return 'completed';
  return 'pending';
}

function sortOrdersForDisplay(orders) {
  return [...orders].sort((a, b) => {
    const rankA = ORDER_STATUS_RANK[a.status] ?? 99;
    const rankB = ORDER_STATUS_RANK[b.status] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

const views = {
  dashboard: { showAddItem: false, posMode: false },
  pos: { showAddItem: false, posMode: true },
  inventory: { showAddItem: true, posMode: false },
  orders: { showAddItem: false, posMode: false },
  customers: { showAddItem: false, posMode: false },
  repairs: { showAddItem: false, posMode: false },
  requests: { showAddItem: false, posMode: false },
  schemes: { showAddItem: false, posMode: false },
  karigar: { showAddItem: false, posMode: false },
  reports: { showAddItem: false, posMode: false },
  expenses: { showAddItem: false, posMode: false },
  calculator: { showAddItem: false, posMode: false },
  settings: { showAddItem: false, posMode: false }
};

let editingId = null;
let itemsCache = [];
let ordersAllCache = [];
let orderItemsCache = [];
let posItemsCache = [];
let goldRateCache = 0;
let goldBuyRateCache = 0;
let goldCalcBuy2RateCache = 0;
const CALC_BUY2_RATE_STORAGE_KEY = 'subarnapasal.calcGoldBuy2RateTola';
let silverRateCache = 0;
const calcRateDraftNpr = {
  gold: { sell: null, buy: null, buy2: null },
  silver: { sell: null }
};
let settingsPriceMode = 'manual';
let locationsCache = [];
let itemCategoriesCache = [...DEFAULT_ITEM_CATEGORIES];
let settingsCache = {
  shopName: 'Suvarnapasal',
  shopAddress: '',
  shopPhone: '',
  shopPan: '',
  vatRate: 13,
  country: 'NP',
  salesTaxRate: 0,
  calendarMode: 'both',
  priceMode: 'manual',
  // Nepal is the default shop location, so NPR is the default display currency.
  currency: 'NPR',
  goldRatePerTola: 0,
  goldBuyRatePerTola: 0,
  silverRatePerTola: 0
};

// ===== Shop location (country) =====
// Nepal (default) keeps every existing behaviour untouched: manual VAT entry,
// the Nepali guarantee bill, the 0.5% skill-promotion fee and the PAN box.
// USA / Canada switch to a custom sales-tax percentage that pre-fills at
// checkout, a plain English invoice, and no skill fee / PAN.
const SHOP_COUNTRIES = {
  NP: { currency: 'NPR', billStyle: 'guarantee', taxKey: 'vat',         hintKey: 'countryHintNP', skillFee: true,  showPan: true,  showCalendar: true,  taxStep: '0.1'   },
  US: { currency: 'USD', billStyle: 'classic',   taxKey: 'taxSalesTax', hintKey: 'countryHintUS', skillFee: false, showPan: false, showCalendar: false, taxStep: '0.001' },
  CA: { currency: 'CAD', billStyle: 'classic',   taxKey: 'taxGstHst',   hintKey: 'countryHintCA', skillFee: false, showPan: false, showCalendar: false, taxStep: '0.001' }
};

function shopCountry() {
  return SHOP_COUNTRIES[settingsCache.country] ? settingsCache.country : 'NP';
}

// Local memory of the chosen country: survives even when the backend doesn't
// store the 'country' field (older API server), so the app never re-detects
// and overrides a choice the user already made.
const SHOP_COUNTRY_STORAGE_KEY = 'subarnapasal.shopCountry';

function storedShopCountry() {
  try {
    const v = localStorage.getItem(SHOP_COUNTRY_STORAGE_KEY);
    return SHOP_COUNTRIES[v] ? v : null;
  } catch (_) { return null; }
}

function rememberShopCountry(country) {
  try {
    if (SHOP_COUNTRIES[country]) localStorage.setItem(SHOP_COUNTRY_STORAGE_KEY, country);
  } catch (_) { /* ignore */ }
}

// Same local memory for the display currency: the user's choice on this
// computer always wins, even if the backend fails to store it.
const DISPLAY_CURRENCY_STORAGE_KEY = 'subarnapasal.displayCurrency';

function storedDisplayCurrency() {
  try {
    const v = localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
    return CURRENCIES[v] ? v : null;
  } catch (_) { return null; }
}

function rememberDisplayCurrency(code) {
  try {
    if (CURRENCIES[code]) localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, code);
  } catch (_) { /* ignore */ }
}

function shopCountryConfig() {
  return SHOP_COUNTRIES[shopCountry()];
}

function isNepalShop() {
  return shopCountry() === 'NP';
}

// "VAT" in Nepal, "Sales Tax" in the USA, "GST/HST" in Canada.
function shopTaxName() {
  return t(shopCountryConfig().taxKey);
}

// The rate the checkout box starts from: the VAT rate in Nepal, the shop's own
// sales-tax percentage in the USA / Canada.
function shopDefaultTaxRate() {
  return isNepalShop()
    ? (Number(settingsCache.vatRate) || 13)
    : (Number(settingsCache.salesTaxRate) || 0);
}

// Settings-form half: which fields make sense for the picked country. Split out
// so the dropdown can preview a country before anything is saved.
function applyCountryFormFields(country) {
  const cfg = SHOP_COUNTRIES[country] || SHOP_COUNTRIES.NP;
  const hint = document.getElementById('settings-country-hint');
  if (hint) hint.textContent = t(cfg.hintKey);
  const panField = document.getElementById('settings-pan-field');
  if (panField) panField.hidden = !cfg.showPan;
  const calendarField = document.getElementById('settings-calendar-field');
  if (calendarField) calendarField.hidden = !cfg.showCalendar;
  const vatField = document.getElementById('settings-vat-field');
  if (vatField) vatField.hidden = country !== 'NP';
  const salesTaxField = document.getElementById('settings-salestax-field');
  if (salesTaxField) salesTaxField.hidden = country === 'NP';
  const salesTaxLabel = document.getElementById('settings-salestax-label');
  if (salesTaxLabel) salesTaxLabel.textContent = `${t(cfg.taxKey)} (%)`;
}

// Show/hide the country-specific bits of Settings and the POS panel.
function applyShopCountryUi() {
  const country = shopCountry();
  const cfg = SHOP_COUNTRIES[country];

  const select = document.getElementById('settings-country');
  if (select && select.value !== country) select.value = country;

  applyCountryFormFields(country);

  const salesTaxInput = document.getElementById('settings-sales-tax-rate');
  if (salesTaxInput && !salesTaxInput.matches(':focus')) {
    salesTaxInput.value = Number(settingsCache.salesTaxRate) > 0 ? settingsCache.salesTaxRate : '';
  }

  // POS panel: tax row label + the Nepal-only skill promotion fee.
  const cartTaxLabel = document.getElementById('cart-tax-label');
  if (cartTaxLabel) cartTaxLabel.textContent = shopTaxName();
  const skillFeeRow = document.getElementById('pos-skillfee-row');
  if (skillFeeRow) skillFeeRow.hidden = !cfg.skillFee;
  const skillFeeBox = document.getElementById('pos-skill-fee');
  if (skillFeeBox && !cfg.skillFee) skillFeeBox.checked = false;

  // Payment methods follow the location too (eSewa/Khalti are Nepal wallets).
  applyCountryPaymentOptions();

  // Phone numbers and addresses switch to the local format.
  applyCountryContactFormats();

  // Pre-fill the checkout tax box for USA / Canada when no sale is in progress.
  const cartTaxValue = document.getElementById('cart-tax-value');
  if (cartTaxValue && !isNepalShop() && !posCart.length && Number(cartTaxValue.value) === 0) {
    cartTaxValue.value = Number(settingsCache.salesTaxRate) || 0;
  }

  // Bill format follows the location (still overridable in the print dialog).
  const billStyle = document.getElementById('bill-style-select');
  if (billStyle && billStyle.dataset.countryApplied !== country) {
    billStyle.value = cfg.billStyle;
    billStyle.dataset.countryApplied = country;
  }

  updateTaxInputUi();
}

// ===== Country-specific payment methods =====
// Nepal shows everything (Cash, eSewa, Khalti, Card, Bank transfer, Credit).
// USA / Canada show only Cash, Card and Credit (due) — the local wallets and
// bank-transfer option don't apply there. Options are hidden + disabled rather
// than removed, so switching the location back to Nepal restores them all.
const PAYMENT_SELECT_IDS = [
  'cart-payment-method',    // POS checkout
  'receive-payment-method', // receive payment on a due bill
  'repair-payment-method',  // repair delivered & collected
  'scheme-deposit-method'   // gold-scheme deposit (Nepal-only feature anyway)
];
const NON_NEPAL_PAY_METHODS = ['cash', 'card', 'credit'];

function applyCountryPaymentOptions() {
  const nepal = isNepalShop();
  PAYMENT_SELECT_IDS.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    let selectionRemoved = false;
    Array.from(select.options).forEach((opt) => {
      const allowed = nepal || NON_NEPAL_PAY_METHODS.includes(opt.value);
      opt.hidden = !allowed;
      opt.disabled = !allowed;
      if (!allowed && select.value === opt.value) selectionRemoved = true;
    });
    if (selectionRemoved) select.value = 'cash';
  });
}

// ===== Country-specific phone + address formats =====
// Nepal: mobile numbers as 98XXXXXXXX (digits only) and addresses in the local
// Tole/Ward style. USA / Canada: phones auto-format as (XXX) XXX-XXXX while
// typing, and addresses use the Street, City, State ZIP style. The customer
// modal keeps its own per-customer phone-region dropdown (a Nepal shop can
// still save a US customer and vice versa) — it just defaults to the shop's
// country now instead of guessing from the browser.
const ADDRESS_PLACEHOLDER_KEYS = { NP: 'addrPlaceholderNP', US: 'addrPlaceholderUS', CA: 'addrPlaceholderCA' };

function shopPhonePlaceholderText(country) {
  const cfg = typeof PHONE_REGION_CONFIG !== 'undefined' ? PHONE_REGION_CONFIG[country] : null;
  if (!cfg) return '98XXXXXXXX';
  return typeof t === 'function' ? t(cfg.placeholderKey) : cfg.placeholder;
}

// Live mask for phone boxes: US/CA → (555) 123-4567, Nepal → plain digits.
//
// The country code is only dropped once the number is clearly long enough to
// carry one (11 digits for +1, 13 for +977). Stripping it unconditionally wiped
// the box out mid-typing — a US number starting with "1", or a Nepali one whose
// first three digits happened to be "977", vanished as soon as it was typed.
function formatPhoneForRegion(value, region) {
  const digits = String(value || '').replace(/\D/g, '');
  if (region === 'US' || region === 'CA') {
    const local = digits.length > 10 && digits.startsWith('1') ? digits.slice(1) : digits;
    const d = local.slice(0, 10);
    if (d.length > 6) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length > 3) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return d;
  }
  const local = digits.length > 12 && digits.startsWith('977') ? digits.slice(3) : digits;
  return local.slice(0, 10);
}

function applyCountryContactFormats() {
  const country = shopCountry();

  // Keep phone.js validation (used by the customer + signup forms) in sync.
  try { localStorage.setItem('subarnapasal.phoneRegion', country); } catch (_) { /* ignore */ }

  // Customer modal: default its phone-region dropdown to the shop's country.
  const regionSel = document.getElementById('customer-phone-region');
  if (regionSel && regionSel.dataset.countryApplied !== country) {
    regionSel.value = country;
    regionSel.dataset.countryApplied = country;
    if (typeof applyPhoneRegionUI === 'function') {
      applyPhoneRegionUI(
        regionSel,
        document.getElementById('customer-phone-input'),
        document.getElementById('customer-phone-hint'),
        'customer'
      );
    }
  }

  // Every other phone box shows the local example.
  const phonePh = shopPhonePlaceholderText(country);
  document.querySelectorAll('input[type="tel"]').forEach((input) => {
    if (input.id === 'customer-phone-input') return; // driven by its own dropdown
    input.placeholder = phonePh;
  });

  // Address boxes show a local example: shop address, customer, karigar.
  const addrPh = t(ADDRESS_PLACEHOLDER_KEYS[country] || 'addrPlaceholderNP');
  [
    document.querySelector('#settings-store-form [name="shopAddress"]'),
    document.querySelector('#customer-form [name="address"]'),
    document.querySelector('#karigar-form [name="address"]')
  ].forEach((el) => { if (el) el.placeholder = addrPh; });
}

// One document-level mask covers every phone box, including ones inside
// dialogs. The customer modal formats by its own region dropdown; everything
// else formats by the shop's country.
//
// Rewriting input.value moves the caret to the end of the box, so editing the
// middle of a number made the field jump/blink on every keystroke. Remember how
// many DIGITS sat before the caret, then put the caret back after that same
// digit in the reformatted text.
function caretAfterDigits(text, digitCount) {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/\d/.test(text[i])) {
      seen += 1;
      if (seen === digitCount) return i + 1;
    }
  }
  return text.length;
}

document.addEventListener('input', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'tel') return;
  const region = input.id === 'customer-phone-input'
    ? (document.getElementById('customer-phone-region')?.value || shopCountry())
    : shopCountry();
  const raw = input.value;
  const formatted = formatPhoneForRegion(raw, region);
  if (formatted === raw) return;

  let caret = null;
  try {
    const pos = input.selectionStart;
    if (pos != null) {
      const digitsBeforeCaret = raw.slice(0, pos).replace(/\D/g, '').length;
      caret = caretAfterDigits(formatted, digitsBeforeCaret);
    }
  } catch (_) { /* selection API unavailable on this input */ }

  input.value = formatted;
  if (caret != null) {
    try { input.setSelectionRange(caret, caret); } catch (_) { /* ignore */ }
  }
});

// Nepal → NPR, USA → USD, Canada → CAD. Called only when the location changes;
// the Display currency dropdown can still be set to anything afterwards.
async function switchCurrencyForCountry(country) {
  const target = (SHOP_COUNTRIES[country] || SHOP_COUNTRIES.NP).currency;
  if (displayCurrency === target) return;
  const prevCurrency = displayCurrency;
  setDisplayCurrency(target);
  // Local choice sticks no matter what the backend does.
  settingsCache.currency = displayCurrency;
  rememberDisplayCurrency(displayCurrency);
  initCurrencySelect();
  api('/api/settings', { method: 'PATCH', body: JSON.stringify({ currency: displayCurrency }) })
    .catch(() => { /* re-saves on next launch */ });
  await refreshAfterCurrencyChange(prevCurrency).catch(() => {});
}

let rateHistoryCache = [];
let liveDailyReadings = [];
let liveDailyCurrentTick = null;
let liveDailyFlatAnchor = null;
let liveDailySecondSeries = [];
let liveDailySecondSeq = 0;
let metalRatePollTimer = null;
const METAL_RATE_POLL_MS = 1000;
let lastSaleBill = null;
let activeView = 'dashboard';
let posCart = [];
// Old-gold trade-in attached to the current sale (null = none).
let posOldGold = null;
// Gold-scheme being redeemed against the current sale ('' = none).
let posSchemeId = '';
let schemesCache = [];
let repairsCache = [];
let requestsCache = [];
let salesCache = [];
let reportTab = 'sales';
let orderGroup = 'new';
let reportCache = null;
let selectedCustomer = null;
let customersCache = [];
let customersPollTimer = null;
const CUSTOMERS_POLL_MS = 15000;
let localCustomersMigrated = false;

function rowCountLabel(selected, total) {
  return t('rowsSelectedFmt').replace('{s}', selected).replace('{n}', total);
}

function requireSignedInSync() {
  if (typeof isAuthRequired === 'function' && isAuthRequired()) {
    if (typeof isSignedInSync === 'function' && !isSignedInSync()) {
      if (typeof redirectToLogin === 'function') redirectToLogin();
      throw new Error(t('signInRequired'));
    }
  }
}

async function requireSignedIn() {
  if (typeof waitForAuthReady === 'function') await waitForAuthReady();
  requireSignedInSync();
}

function localData(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  if (fallback) {
    const canSeed = !(typeof isAuthRequired === 'function' && isAuthRequired()
      && typeof isSignedInSync === 'function' && !isSignedInSync());
    if (canSeed) localStorage.setItem(key, JSON.stringify(fallback));
  }
  return fallback || [];
}

function saveLocalData(key, data) {
  requireSignedInSync();
  localStorage.setItem(key, JSON.stringify(data));
}

function getOrdersSearchQuery() {
  return document.getElementById('search-orders')?.value.trim().toLowerCase() || '';
}

function filterOrdersBySearch(orders, search = getOrdersSearchQuery()) {
  if (!search) return orders;
  return orders.filter((o) => {
    const hay = `${o.orderNumber} ${o.customerName} ${o.status} ${orderItemsSummary(o)}`.toLowerCase();
    return hay.includes(search);
  });
}

function selectOrderGroupForSearch(matches, search) {
  if (!matches.length) return;

  for (const group of ORDER_GROUPS) {
    const label = t(group.labelKey).toLowerCase();
    const statusHit = group.statuses.some((s) => search.includes(s) || label.includes(search) || search.includes(label));
    if (statusHit && matches.some((o) => group.statuses.includes(o.status))) {
      orderGroup = group.id;
      return;
    }
  }

  const counts = ORDER_GROUPS.map((group) => ({
    id: group.id,
    count: matches.filter((o) => group.statuses.includes(o.status)).length
  }));
  const best = counts.reduce((a, b) => (b.count > a.count ? b : a), counts[0]);
  if (best.count > 0) orderGroup = best.id;
  else if (matches[0]) orderGroup = orderGroupIdForStatus(matches[0].status) || orderGroup;
}

function updateOrderGroupTabsUI() {
  const search = getOrdersSearchQuery();
  const matches = search ? filterOrdersBySearch(ordersAllCache, search) : ordersAllCache;
  document.querySelectorAll('.order-group-tab').forEach((tab) => {
    const groupId = tab.dataset.orderGroup;
    const group = ORDER_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const label = t(group.labelKey);
    const count = matches.filter((o) => group.statuses.includes(o.status)).length;
    tab.textContent = count > 0 ? `${label} (${count})` : label;
    tab.classList.toggle('has-search-matches', Boolean(search && count > 0));
    tab.classList.toggle('is-active', groupId === orderGroup);
  });
}

function applyOrdersSearch() {
  const search = getOrdersSearchQuery();
  if (search) {
    const matches = filterOrdersBySearch(ordersAllCache, search);
    selectOrderGroupForSearch(matches, search);
  }
  renderOrdersView();
}

function orderDueDate(order) {
  const d = new Date(order.createdAt);
  d.setDate(d.getDate() + 14);
  return d;
}

function orderItemsSummary(order) {
  return (order.lines || []).map((l) => {
    const metal = categoryLabel(l.category || 'gold');
    const bits = [`${metal}: ${l.itemName} × ${l.quantity}`];
    if (l.weightGrams) bits.push(`${Number(l.weightGrams).toFixed(3)}g`);
    if (l.jartiWeightGrams > 0) bits.push(`jarti ${Number(l.jartiWeightGrams).toFixed(3)}g`);
    else if (l.jartiRateValue > 0) bits.push(`jarti ${l.jartiRateType || 'percent'}:${l.jartiRateValue}`);
    if (l.karat) bits.push(`${l.karat}K`);
    return bits.join(' · ');
  }).join(', ') || '—';
}

function gramsToTola(g) {
  return (g / TOLA_GRAMS).toFixed(3);
}

function truncateWeight(value, decimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.floor(n * factor + 1e-10) / factor;
}

function normalizeWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}

function formatWeightQty(value, decimals = 4) {
  const t = truncateWeight(value, decimals);
  if (Number.isInteger(t)) return String(t);
  const fixed = t.toFixed(decimals);
  return fixed.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function weightFieldNames(prefix = '') {
  if (!prefix) {
    return {
      prefix,
      unitName: 'weightUnit',
      gramsName: 'weightGrams',
      tolaName: 'weightTola',
      aanaName: 'weightAana',
      laalName: 'weightLaal'
    };
  }
  return {
    prefix,
    unitName: `${prefix}WeightUnit`,
    gramsName: `${prefix}WeightGrams`,
    tolaName: `${prefix}WeightTola`,
    aanaName: `${prefix}WeightAana`,
    laalName: `${prefix}WeightLaal`
  };
}

function tolaPartsToGrams(tola = 0, aana = 0, laal = 0) {
  const t = Number(tola) || 0;
  const a = Number(aana) || 0;
  const l = Number(laal) || 0;
  if (t <= 0 && a <= 0 && l <= 0) return 0;
  const totalLaal = t * LAAL_PER_TOLA + a * LAAL_PER_AANA + l;
  return (totalLaal * TOLA_GRAMS) / LAAL_PER_TOLA;
}

function totalLaalToTolaParts(totalLaal) {
  const tl = Math.max(0, Math.floor(totalLaal));
  const tola = Math.floor(tl / LAAL_PER_TOLA);
  const remLaal = tl - tola * LAAL_PER_TOLA;
  return { tola, aana: 0, laal: remLaal };
}

function laalPartToAanaLaal(remainderLaal) {
  // Aana removed from the UI: 1 tola = 100 laal, remainder is all laal.
  return { aana: 0, laal: remainderLaal };
}

const LAAL_SNAP_GRAMS = 0.015;
const TOLA_CENTIGRAMS = 1166;

function gramsToCentigrams(grams) {
  return Math.round(normalizeWeight(grams) * 100);
}

function centigramsToGrams(cg) {
  return normalizeWeight(cg / 100);
}

function formatLaalQty(value) {
  return formatWeightQty(value, 2);
}

function remainderCgToLaal(remainderCg) {
  const numer = remainderCg * LAAL_PER_TOLA;
  const denom = TOLA_GRAMS * 100;
  return Math.floor((numer / denom) * 10000 + 1e-9) / 10000;
}

function gramsToTolaParts(grams) {
  const g = normalizeWeight(grams);
  if (!Number.isFinite(g) || g <= 0) {
    return { tola: '', aana: '', laal: '', remainderGrams: 0, remainderLaal: 0 };
  }
  const totalLaalFloat = (g * LAAL_PER_TOLA) / TOLA_GRAMS;
  const totalLaalRounded = Math.round(totalLaalFloat);
  const gramsFromLaal = (totalLaalRounded * TOLA_GRAMS) / LAAL_PER_TOLA;
  if (Math.abs(g - gramsFromLaal) < LAAL_SNAP_GRAMS) {
    return { ...totalLaalToTolaParts(totalLaalRounded), remainderGrams: 0, remainderLaal: 0 };
  }
  const cg = gramsToCentigrams(g);
  const tola = Math.floor(cg / TOLA_CENTIGRAMS);
  const remainderCg = cg - tola * TOLA_CENTIGRAMS;
  if (remainderCg <= 0) {
    return { tola, aana: 0, laal: 0, remainderGrams: 0, remainderLaal: 0 };
  }
  const remainderLaal = remainderCgToLaal(remainderCg);
  const { aana, laal } = laalPartToAanaLaal(remainderLaal);
  const remainderGrams = centigramsToGrams(remainderCg);
  return { tola, aana, laal, remainderGrams, remainderLaal };
}

function buildWeightFormStub(root, prefix = '') {
  const names = weightFieldNames(prefix);
  const stub = {
    querySelector: (sel) => root.querySelector(sel),
    elements: {}
  };
  Object.values(names).forEach((name) => {
    if (name) stub.elements[name] = root.querySelector(`[name="${name}"]`);
  });
  return stub;
}

function formatWeightFromForm(form, prefix = '') {
  const grams = getWeightGramsFromForm(form, prefix);
  if (grams <= 0) return '—';
  const gramsDisplay = formatWeightQty(grams, 4);
  if (getWeightUnit(form, prefix) === 'tola') {
    const names = weightFieldNames(prefix);
    const tola = form.elements[names.tolaName]?.value ?? '';
    const aana = form.elements[names.aanaName]?.value ?? '';
    const laal = form.elements[names.laalName]?.value ?? '';
    if (!Number(tola) && !Number(aana) && !Number(laal)) return '—';
    const tolaText = tola === '' ? '0' : tola;
    const aanaText = aana === '' ? '0' : aana;
    const laalText = laal === '' ? '0' : laal;
    return `${tolaText} ${t('weightTolaShort')} · ${aanaText} ${t('weightAanaShort')} · ${laalText} ${t('weightLaalShort')} = ${gramsDisplay} g`;
  }
  return formatWeightParts(grams);
}

function formatWeightParts(grams) {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return '—';
  const parts = gramsToTolaParts(g);
  const bits = [`${formatWeightQty(g, 3)} g`];
  if (parts.tola !== '' || parts.aana !== '' || parts.laal !== '') {
    bits.push(`${parts.tola || 0} ${t('weightTolaShort')} · ${parts.aana || 0} ${t('weightAanaShort')} · ${formatWeightQty(parts.laal, 4)} ${t('weightLaalShort')}`);
  }
  return bits.join(' · ');
}

function getWeightEntryEl(form, prefix = '') {
  if (!form) return null;
  return form.querySelector(`.weight-entry[data-weight-prefix="${prefix}"]`)
    || form.querySelector('.weight-entry');
}

function getWeightUnit(form, prefix = '') {
  const entry = getWeightEntryEl(form, prefix);
  const names = weightFieldNames(prefix);
  const unitEl = entry?.querySelector(`[name="${names.unitName}"]`) || form?.elements[names.unitName];
  return unitEl?.value === 'tola' ? 'tola' : 'grams';
}

function getWeightGramsFromForm(form, prefix = '') {
  if (!form) return 0;
  const names = weightFieldNames(prefix);
  if (getWeightUnit(form, prefix) === 'tola') {
    return tolaPartsToGrams(
      form.elements[names.tolaName]?.value,
      form.elements[names.aanaName]?.value,
      form.elements[names.laalName]?.value
    );
  }
  return Number(form.elements[names.gramsName]?.value) || 0;
}

function getTolaPartsFromForm(form, prefix = '') {
  const names = weightFieldNames(prefix);
  return {
    tola: Number(form.elements[names.tolaName]?.value) || 0,
    aana: Number(form.elements[names.aanaName]?.value) || 0,
    laal: Number(form.elements[names.laalName]?.value) || 0
  };
}

function hasWeightFromForm(form, prefix = '') {
  if (!form) return false;
  if (getWeightUnit(form, prefix) === 'tola') {
    const parts = getTolaPartsFromForm(form, prefix);
    return Boolean(parts.tola || parts.aana || parts.laal);
  }
  return getWeightGramsFromForm(form, prefix) > 0;
}

function calcGoldMetalNpr({ grams = 0, unit = 'grams', tolaParts = null, ratePerTolaNpr = goldRateCache } = {}) {
  const rate = Number(ratePerTolaNpr) || 0;
  if (!rate) return 0;
  if (unit === 'tola' && tolaParts) {
    const t = Number(tolaParts.tola) || 0;
    const a = Number(tolaParts.aana) || 0;
    const l = Number(tolaParts.laal) || 0;
    if (!t && !a && !l) return 0;
    const rateAana = rate / AANA_PER_TOLA;
    const rateLaal = rate / LAAL_PER_TOLA;
    return t * rate + a * rateAana + l * rateLaal;
  }
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  return g * (rate / TOLA_GRAMS);
}

function formatGoldWeightPriceBreakdown(tolaParts, ratePerTolaNpr, makingChargeNpr = 0) {
  const rate = Number(ratePerTolaNpr) || 0;
  if (!rate || !tolaParts) return '';
  const rateAana = rate / AANA_PER_TOLA;
  const rateLaal = rate / LAAL_PER_TOLA;
  const bits = [];
  const t = Number(tolaParts.tola) || 0;
  const a = Number(tolaParts.aana) || 0;
  const l = Number(tolaParts.laal) || 0;
  if (t) bits.push(`${t} ${t('calcTola')} × ${formatMoney(rate)}`);
  if (a) bits.push(`${a} ${t('calcAana')} × ${formatMoney(rateAana)}`);
  if (l) bits.push(`${formatWeightQty(l, 4)} ${t('calcLaal')} × ${formatMoney(rateLaal)}`);
  if (!bits.length) return '';
  const metal = calcGoldMetalNpr({ unit: 'tola', tolaParts, ratePerTolaNpr: rate });
  const making = Number(makingChargeNpr) || 0;
  const total = metal + making;
  return `${bits.join(' + ')}${making ? ` + ${t('calcMakingCharge')} ${formatMoney(making)}` : ''} = ${formatMoney(total)}`;
}

function renderOrderPriceBreakdown({ weightUnit, weightGrams, tolaParts, makingChargeNpr, qty = 1, ratePerTolaNpr = getGoldRatePerTolaNpr(), jartiRateType = 'flat', jartiRateValue = 0, karatFactor = 1 }) {
  const rate = Number(ratePerTolaNpr) || 0;
  if (!rate) return '';
  const making = Number(makingChargeNpr) || 0;
  let metalNpr = 0;
  let weightRows = '';

  if (weightUnit === 'tola' && tolaParts && (tolaParts.tola || tolaParts.aana || tolaParts.laal)) {
    const rateAana = rate / AANA_PER_TOLA;
    const rateLaal = rate / LAAL_PER_TOLA;
    const rows = [];
    if (tolaParts.tola) {
      const sub = tolaParts.tola * rate;
      metalNpr += sub;
      rows.push(`<tr><th>${t('calcTola')}</th><td>${tolaParts.tola} × ${formatMoney(rate)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.aana) {
      const sub = tolaParts.aana * rateAana;
      metalNpr += sub;
      rows.push(`<tr><th>${t('calcAana')}</th><td>${tolaParts.aana} × ${formatMoney(rateAana)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.laal) {
      const sub = tolaParts.laal * rateLaal;
      metalNpr += sub;
      rows.push(`<tr><th>${t('calcLaal')}</th><td>${formatWeightQty(tolaParts.laal, 4)} × ${formatMoney(rateLaal)} = ${formatMoney(sub)}</td></tr>`);
    }
    weightRows = rows.join('');
  } else if (weightGrams > 0) {
    const rateGram = rate / TOLA_GRAMS;
    metalNpr = weightGrams * rateGram;
    weightRows = `<tr><th>${t('calcGrams')}</th><td>${formatWeightQty(weightGrams, 4)} g × ${formatMoney(rateGram)} = ${formatMoney(metalNpr)}</td></tr>`;
  } else {
    return '';
  }

  metalNpr *= Number(karatFactor) || 1;
  const jartiGrams = resolveJartiWeightGrams(weightGrams, jartiRateType, jartiRateValue);
  const jarti = calcJartiAmount({
    jartiRateType,
    jartiRateValue,
    weightGrams,
    metalValue: metalNpr,
    ratePerTola: rate,
    karatFactor
  });
  const rateGram = rate / TOLA_GRAMS;
  const jartiRow = jartiGrams > 0
    ? `<tr><th>Jarti weight</th><td>${formatWeightQty(jartiGrams, 4)} g × ${formatMoney(rateGram)}${karatFactor !== 1 ? ` × ${formatWeightQty(karatFactor, 4)}` : ''} = ${formatMoney(jarti)}</td></tr>`
    : '';
  const billableWeight = weightGrams + jartiGrams;
  const billableRow = jartiGrams > 0
    ? `<tr><th>Total weight (charged)</th><td>${formatWeightQty(weightGrams, 4)} g + ${formatWeightQty(jartiGrams, 4)} g jarti = <strong>${formatWeightQty(billableWeight, 4)} g</strong></td></tr>
       <tr><th>Final weight (after jarti)</th><td>${formatWeightQty(billableWeight, 4)} g − ${formatWeightQty(jartiGrams, 4)} g = <strong>${formatWeightQty(weightGrams, 4)} g</strong></td></tr>`
    : '';
  const unitTotal = metalNpr + making + jarti;
  const orderTotal = unitTotal * qty;
  const qtyRow = qty > 1
    ? `<tr><th>${t('quantity')}</th><td>${formatMoney(unitTotal)} × ${qty} = ${formatMoney(orderTotal)}</td></tr>`
    : '';

  return `
    <table class="gold-calc-table gold-price-summary">
      <tbody>
        ${weightRows}
        ${billableRow}
        ${jartiRow}
        <tr><th>${t('calcMakingCharge')}</th><td>${formatMoney(making)}</td></tr>
        ${qtyRow}
        <tr class="gold-calc-total-row"><th>${t('calcTotalPrice')}</th><td><strong>${formatMoney(orderTotal)}</strong></td></tr>
      </tbody>
    </table>`;
}

function updateWeightEntryHint(entry) {
  if (!entry) return;
  const hint = entry.querySelector('.weight-conversion-hint');
  if (!hint) return;
  const prefix = entry.dataset.weightPrefix || '';
  const form = entry.closest('form') || buildWeightFormStub(entry.closest('#view-calculator') || entry, prefix);
  const grams = getWeightGramsFromForm(form, prefix);
  if (grams > 0) {
    hint.hidden = false;
    hint.textContent = formatWeightFromForm(form, prefix);
  } else {
    hint.hidden = true;
    hint.textContent = '';
  }
}

function setWeightEntryPanels(entry, unit) {
  if (!entry) return;
  const isTola = unit === 'tola';
  entry.dataset.weightMode = isTola ? 'tola' : 'grams';
  entry.querySelectorAll('.weight-panel-grams').forEach((el) => el.toggleAttribute('hidden', isTola));
  entry.querySelectorAll('.weight-panel-tola').forEach((el) => el.toggleAttribute('hidden', !isTola));
  entry.querySelectorAll('.weight-panel-aana').forEach((el) => el.toggleAttribute('hidden', !isTola));
  entry.querySelectorAll('.weight-panel-laal').forEach((el) => el.toggleAttribute('hidden', !isTola));
}

function setWeightFieldsFromGrams(form, grams, prefix = '') {
  if (!form) return;
  const entry = getWeightEntryEl(form, prefix);
  if (!entry) return;
  const names = weightFieldNames(prefix);
  const g = Number(grams);
  const unitEl = form.elements[names.unitName];
  const gramsEl = form.elements[names.gramsName];
  const tolaEl = form.elements[names.tolaName];
  const aanaEl = form.elements[names.aanaName];
  const laalEl = form.elements[names.laalName];
  if (!Number.isFinite(g) || g <= 0) {
    if (gramsEl) gramsEl.value = '';
    if (tolaEl) tolaEl.value = '';
    if (aanaEl) aanaEl.value = '';
    if (laalEl) laalEl.value = '';
    updateWeightEntryHint(entry);
    return;
  }
  const parts = gramsToTolaParts(g);
  if (gramsEl) gramsEl.value = g;
  if (tolaEl) tolaEl.value = parts.tola;
  if (aanaEl) aanaEl.value = parts.aana;
  if (laalEl) laalEl.value = formatWeightQty(parts.laal, 4);
  if (unitEl) unitEl.value = 'grams';
  setWeightEntryPanels(entry, 'grams');
  updateWeightEntryHint(entry);
}

function initWeightEntry(entry) {
  if (!entry || entry.dataset.weightBound) return;
  entry.dataset.weightBound = '1';
  const form = entry.closest('form');
  const prefix = entry.dataset.weightPrefix || '';
  const names = weightFieldNames(prefix);
  const unitEl = entry.querySelector(`[name="${names.unitName}"]`) || form?.elements[names.unitName];
  if (unitEl) {
    unitEl.addEventListener('change', () => {
      const isTola = unitEl.value === 'tola';
      const gramsEl = entry.querySelector(`[name="${names.gramsName}"]`);
      const tolaEl = entry.querySelector(`[name="${names.tolaName}"]`);
      const aanaEl = entry.querySelector(`[name="${names.aanaName}"]`);
      const laalEl = entry.querySelector(`[name="${names.laalName}"]`);
      if (isTola) {
        // Convert the typed grams into tola/laal instead of losing them.
        const g = Number(gramsEl?.value) || 0;
        if (g > 0) {
          const parts = gramsToTolaParts(g);
          if (tolaEl) tolaEl.value = Number(parts.tola) || 0;
          if (aanaEl) aanaEl.value = '';
          if (laalEl) laalEl.value = formatWeightQty((Number(parts.aana) || 0) * LAAL_PER_AANA + (Number(parts.laal) || 0), 4);
        }
        if (gramsEl) gramsEl.value = '';
      } else {
        // Convert tola/laal back into grams.
        const g = tolaPartsToGrams(tolaEl?.value, aanaEl?.value, laalEl?.value);
        if (g > 0 && gramsEl) gramsEl.value = Number(g.toFixed(4));
        if (tolaEl) tolaEl.value = '';
        if (aanaEl) aanaEl.value = '';
        if (laalEl) laalEl.value = '';
      }
      setWeightEntryPanels(entry, unitEl.value);
      updateWeightEntryHint(entry);
      entry.dispatchEvent(new CustomEvent('weight-updated', { bubbles: true }));
    });
    setWeightEntryPanels(entry, unitEl.value || 'grams');
  }
  entry.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      updateWeightEntryHint(entry);
      entry.dispatchEvent(new CustomEvent('weight-updated', { bubbles: true }));
    });
  });
}

function initAllWeightEntries() {
  document.querySelectorAll('.weight-entry').forEach(initWeightEntry);
}

function syncWeightEntryPanels(form, prefix = '') {
  const entry = getWeightEntryEl(form, prefix);
  if (!entry) return;
  initWeightEntry(entry);
  setWeightEntryPanels(entry, getWeightUnit(form, prefix));
  updateWeightEntryHint(entry);
}

function getGoldRatePerTolaNpr() {
  return Number(goldRateCache) || 0;
}

function getCalcMetal() {
  return document.getElementById('calc-metal')?.value === 'silver' ? 'silver' : 'gold';
}

function getCalcPriceType() {
  if (getCalcMetal() !== 'gold') return 'sell';
  const value = document.getElementById('calc-price-type')?.value;
  if (value === 'buy2') return 'buy2';
  if (value === 'buy') return 'buy';
  return 'sell';
}

function loadCalcBuy2RateCache() {
  try {
    const raw = localStorage.getItem(CALC_BUY2_RATE_STORAGE_KEY);
    const n = Number(raw);
    goldCalcBuy2RateCache = Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_) {
    goldCalcBuy2RateCache = 0;
  }
}

function saveCalcBuy2RateCache(tolaNpr) {
  goldCalcBuy2RateCache = Math.max(0, Number(tolaNpr) || 0);
  try {
    localStorage.setItem(CALC_BUY2_RATE_STORAGE_KEY, String(goldCalcBuy2RateCache));
  } catch (_) { /* ignore */ }
}

function calcRateInputToTolaNpr() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput?.value) return 0;
  const npr = parseMoneyField(rateInput.value);
  if (!npr) return 0;
  return getCalcUseGram() ? npr * TOLA_GRAMS : npr;
}

function persistCalcBuy2RateFromInput() {
  if (getCalcMetal() !== 'gold' || getCalcPriceType() !== 'buy2') return;
  saveCalcBuy2RateCache(calcRateInputToTolaNpr());
}

function getCalcRateDraft(metal, priceType) {
  const slot = calcRateDraftNpr[metal];
  if (!slot) return null;
  if (metal === 'silver') return slot.sell;
  return slot[priceType] ?? null;
}

function setCalcRateDraft(metal, priceType, value) {
  if (!calcRateDraftNpr[metal]) {
    calcRateDraftNpr[metal] = metal === 'silver'
      ? { sell: null }
      : { sell: null, buy: null, buy2: null };
  }
  if (metal === 'silver') calcRateDraftNpr[metal].sell = value;
  else calcRateDraftNpr[metal][priceType] = value;
}

function getCalcMetalRateCache() {
  if (getCalcMetal() === 'silver') return silverRateCache;
  const priceType = getCalcPriceType();
  if (priceType === 'buy2') return goldCalcBuy2RateCache;
  if (priceType === 'buy') return goldBuyRateCache;
  return goldRateCache;
}

function getCalcUseGram() {
  const view = document.getElementById('view-calculator');
  const stub = view ? buildWeightFormStub(view, 'conv') : null;
  return stub ? getWeightUnit(stub, 'conv') !== 'tola' : true;
}

function getCalcRateLabelKey(useGram) {
  const metal = getCalcMetal();
  if (metal === 'silver') return useGram ? 'silverRateGram' : 'silverRateTola';
  const priceType = getCalcPriceType();
  if (priceType === 'buy2') return useGram ? 'goldCalcBuy2RateGram' : 'goldCalcBuy2RateTola';
  if (priceType === 'buy') return useGram ? 'goldBuyRateGram' : 'goldBuyRateTola';
  return useGram ? 'goldRateGram' : 'goldRateTola';
}

function persistCalcRateDraft() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput || rateInput.dataset.userEdited !== '1' || !rateInput.value) return;
  setCalcRateDraft(getCalcMetal(), getCalcPriceType(), parseMoneyField(rateInput.value));
}

function applyCalcRateField() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput) return;
  const metal = getCalcMetal();
  const priceType = getCalcPriceType();
  const useGram = getCalcUseGram();
  const draft = getCalcRateDraft(metal, priceType);
  if (draft != null && draft > 0) {
    rateInput.value = useGram ? formatRateInput(draft) : formatMoneyField(draft);
    rateInput.dataset.userEdited = '1';
    return;
  }
  rateInput.dataset.userEdited = '';
  syncGoldCalcRateField();
}

function syncCalcPriceTypeVisibility() {
  const wrap = document.getElementById('calc-price-type-wrap');
  if (!wrap) return;
  const isGold = getCalcMetal() === 'gold';
  wrap.hidden = !isGold;
  if (!isGold) {
    const sel = document.getElementById('calc-price-type');
    if (sel) sel.value = 'sell';
  }
}

function syncGoldCalcRateUnitFromWeight() {
  const view = document.getElementById('view-calculator');
  const rateUnitEl = document.getElementById('gold-calc-rate-unit');
  const rateInput = document.getElementById('gold-calc-rate');
  if (!view || !rateUnitEl) return;
  const stub = buildWeightFormStub(view, 'conv');
  const weightUnit = getWeightUnit(stub, 'conv');
  const nextRateUnit = weightUnit === 'tola' ? 'tola' : 'gram';
  const prevRateUnit = rateUnitEl.value === 'gram' ? 'gram' : 'tola';
  if (prevRateUnit !== nextRateUnit) {
    const currentRate = parseMoneyField(rateInput?.value) || 0;
    if (currentRate > 0 && rateInput?.dataset.userEdited === '1') {
      if (prevRateUnit === 'tola' && nextRateUnit === 'gram') {
        rateInput.value = formatGramRateFromTola(currentRate);
      } else if (prevRateUnit === 'gram' && nextRateUnit === 'tola') {
        rateInput.value = formatMoneyField(currentRate * TOLA_GRAMS);
      }
      persistCalcRateDraft();
    } else if (rateInput) {
      rateInput.dataset.userEdited = '';
    }
  }
  rateUnitEl.value = nextRateUnit;
}

function getGoldCalcPriceWeight(ctx) {
  if (!ctx || ctx.grams <= 0) return { qty: 0, label: '' };
  if (ctx.unit === 'tola') {
    const tola = ctx.grams / TOLA_GRAMS;
    const roundedTola = Math.round(tola * 10000) / 10000;
    const qtyLabel = Number.isInteger(roundedTola)
      ? String(roundedTola)
      : formatWeightQty(tola, 4);
    return {
      qty: tola,
      label: qtyLabel
    };
  }
  return {
    qty: ctx.grams,
    label: `${formatWeightQty(ctx.grams, 4)} g`
  };
}

function updateGoldCalcRateLabel() {
  const useGram = getCalcUseGram();
  const label = document.getElementById('gold-calc-rate-label');
  if (label) {
    const key = getCalcRateLabelKey(useGram);
    label.textContent = labelWithCurrency(key);
    label.dataset.currencyField = key;
  }
}

function refreshGoldCalcForCurrency(prevCurrency) {
  const rateInput = document.getElementById('gold-calc-rate');
  const makingInput = document.getElementById('gold-calc-making-charge');
  const useGram = getCalcUseGram();

  if (rateInput) {
    if (rateInput.dataset.userEdited === '1' && rateInput.value) {
      const rateNpr = displayToNprAt(rateInput.value, prevCurrency);
      setCalcRateDraft(getCalcMetal(), getCalcPriceType(), rateNpr);
      rateInput.value = useGram ? formatRateInput(rateNpr) : formatMoneyField(rateNpr);
    } else {
      rateInput.dataset.userEdited = '';
      syncGoldCalcRateField();
    }
  }
  if (makingInput?.value) {
    const makingNpr = displayToNprAt(makingInput.value, prevCurrency);
    makingInput.value = formatMoneyField(makingNpr);
  }
}

function getGoldConvContext() {
  const view = document.getElementById('view-calculator');
  if (!view) return null;
  const stub = buildWeightFormStub(view, 'conv');
  const names = weightFieldNames('conv');
  return {
    unit: getWeightUnit(stub, 'conv'),
    grams: getWeightGramsFromForm(stub, 'conv'),
    form: stub,
    tolaInput: stub.elements[names.tolaName]?.value ?? '',
    aanaInput: stub.elements[names.aanaName]?.value ?? '',
    laalInput: stub.elements[names.laalName]?.value ?? ''
  };
}

function renderGoldConversionResults() {
  const box = document.getElementById('gold-conversion-results');
  if (!box) return;
  const ctx = getGoldConvContext();
  if (!ctx || ctx.grams <= 0) {
    box.innerHTML = `<p class="gold-calc-empty">${t('calcEnterWeight')}</p>`;
    return;
  }
  const { unit, grams, tolaInput, aanaInput, laalInput } = ctx;
  const parts = gramsToTolaParts(grams);
  const laalDisplay = formatWeightQty(parts.laal, 4);
  const laalBreakdown = formatLaalQty(parts.laal);
  const remainderDisplay = formatWeightQty(parts.remainderGrams, 2);
  const gramsDisplay = formatWeightQty(grams, 4);
  const totalTola = formatWeightQty(grams / TOLA_GRAMS, 4);
  const tolaText = tolaInput === '' ? '0' : tolaInput;
  const aanaText = aanaInput === '' ? '0' : aanaInput;
  const laalText = laalInput === '' ? '0' : laalInput;
  if (unit === 'grams') {
    const remainderLine = parts.remainderGrams > 1e-9
      ? `<p class="gold-conv-breakdown">${parts.tola || 0} ${t('calcTola')} (${TOLA_GRAMS} g) + ${remainderDisplay} g = ${parts.aana || 0} ${t('calcAana')} · ${laalBreakdown} ${t('calcLaal')}</p>`
      : '';
    box.innerHTML = `
      <div class="gold-conv-output">
        <h4 class="gold-results-title">${t('calcConvertedTo')}</h4>
        <div class="gold-conv-output-grid">
          <div class="gold-conv-output-item"><span>${t('calcTola')}</span><strong>${parts.tola || 0}</strong></div>
          <div class="gold-conv-output-item"><span>${t('calcAana')}</span><strong>${parts.aana || 0}</strong></div>
          <div class="gold-conv-output-item"><span>${t('calcLaal')}</span><strong>${laalDisplay}</strong></div>
        </div>
        ${remainderLine}
        <p class="gold-conv-detail">${gramsDisplay} ${t('calcGrams')} = ${parts.tola || 0} ${t('weightTolaShort')} · ${parts.aana || 0} ${t('weightAanaShort')} · ${laalDisplay} ${t('weightLaalShort')}</p>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="gold-conv-output">
      <h4 class="gold-results-title">${t('calcEqualsGrams')}</h4>
      <div class="gold-conv-grams-value"><strong>${gramsDisplay}</strong><span>g</span></div>
      <p class="gold-conv-detail">${tolaText} ${t('weightTolaShort')} · ${aanaText} ${t('weightAanaShort')} · ${laalText} ${t('weightLaalShort')} = ${gramsDisplay} g</p>
      <p class="gold-conv-sub">${totalTola} ${t('calcTola')} (${t('calcAllUnits')})</p>
    </div>`;
}

function renderGoldPriceResult() {
  const box = document.getElementById('gold-price-result');
  if (!box) return;
  const ctx = getGoldConvContext();
  const rateNpr = parseMoneyField(document.getElementById('gold-calc-rate')?.value) || 0;
  const makingNpr = parseMoneyField(document.getElementById('gold-calc-making-charge')?.value) || 0;
  if (!ctx || ctx.grams <= 0 || rateNpr <= 0) {
    box.innerHTML = `<p class="gold-calc-empty">${t('calcEnterWeightCost')}</p>`;
    return;
  }
  let weightRows = '';
  let goldValueNpr = 0;
  if (ctx.unit === 'tola') {
    const tolaParts = {
      tola: Number(ctx.tolaInput) || 0,
      aana: Number(ctx.aanaInput) || 0,
      laal: Number(ctx.laalInput) || 0
    };
    const rateAana = rateNpr / AANA_PER_TOLA;
    const rateLaal = rateNpr / LAAL_PER_TOLA;
    const rows = [];
    if (tolaParts.tola) {
      const sub = tolaParts.tola * rateNpr;
      goldValueNpr += sub;
      rows.push(`<tr><th>${t('calcTola')}</th><td>${tolaParts.tola} × ${formatMoney(rateNpr)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.aana) {
      const sub = tolaParts.aana * rateAana;
      goldValueNpr += sub;
      rows.push(`<tr><th>${t('calcAana')}</th><td>${tolaParts.aana} × ${formatMoney(rateAana)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.laal) {
      const sub = tolaParts.laal * rateLaal;
      goldValueNpr += sub;
      rows.push(`<tr><th>${t('calcLaal')}</th><td>${formatWeightQty(tolaParts.laal, 4)} × ${formatMoney(rateLaal)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (!rows.length) {
      const { qty: weightQty, label: weightLabel } = getGoldCalcPriceWeight(ctx);
      goldValueNpr = weightQty * rateNpr;
      weightRows = `<tr><th>${t('calcWeightTimesRate')}</th><td>${weightLabel} × ${formatMoney(rateNpr)} = ${formatMoney(goldValueNpr)}</td></tr>`;
    } else {
      weightRows = rows.join('');
    }
  } else {
    const { qty: weightQty, label: weightLabel } = getGoldCalcPriceWeight(ctx);
    goldValueNpr = weightQty * rateNpr;
    weightRows = `<tr><th>${t('calcWeightTimesRate')}</th><td>${weightLabel} × ${formatMoney(rateNpr)} = ${formatMoney(goldValueNpr)}</td></tr>`;
  }
  const totalNpr = goldValueNpr + makingNpr;
  const priceType = getCalcPriceType();
  const totalLabel = priceType === 'buy2'
    ? t('calcTotalBuy2Price')
    : priceType === 'buy'
      ? t('calcTotalBuyPrice')
      : t('calcTotalSellPrice');
  box.innerHTML = `
    <table class="gold-calc-table gold-price-summary">
      <tbody>
        ${weightRows}
        <tr><th>${t('calcMakingCharge')}</th><td>${formatMoney(makingNpr)}</td></tr>
        <tr class="gold-calc-total-row"><th>${totalLabel}</th><td><strong>${formatMoney(totalNpr)}</strong></td></tr>
      </tbody>
    </table>`;
}

function syncGoldCalcRateField() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput || rateInput.dataset.userEdited === '1') return;
  const useGram = getCalcUseGram();
  const rateCache = getCalcMetalRateCache();
  if (!rateCache) {
    rateInput.value = '';
    return;
  }
  rateInput.value = useGram
    ? formatGramRateFromTola(rateCache)
    : formatMoneyField(rateCache);
}

function updateGoldCalculator() {
  syncCalcPriceTypeVisibility();
  syncGoldCalcRateUnitFromWeight();
  updateGoldCalcRateLabel();
  syncGoldCalcRateField();
  renderGoldConversionResults();
  renderGoldPriceResult();
}

function initGoldCalculator() {
  const view = document.getElementById('view-calculator');
  if (!view || view.dataset.goldCalcBound) return;
  view.dataset.goldCalcBound = '1';
  loadCalcBuy2RateCache();
  const bindWeightEntry = (entry) => {
    initWeightEntry(entry);
    entry.addEventListener('weight-updated', updateGoldCalculator);
    entry.addEventListener('input', updateGoldCalculator);
  };
  view.querySelectorAll('.weight-entry').forEach(bindWeightEntry);
  const rateInput = document.getElementById('gold-calc-rate');
  rateInput?.addEventListener('input', () => {
    if (rateInput) rateInput.dataset.userEdited = '1';
    persistCalcRateDraft();
    persistCalcBuy2RateFromInput();
    updateGoldCalculator();
  });
  document.getElementById('gold-calc-making-charge')?.addEventListener('input', updateGoldCalculator);
  document.getElementById('calc-price-type')?.addEventListener('change', () => {
    const rateInput = document.getElementById('gold-calc-rate');
    if (rateInput) rateInput.dataset.userEdited = '';
    applyCalcRateField();
    updateGoldCalculator();
  });
  document.getElementById('calc-metal')?.addEventListener('change', () => {
    const rateInput = document.getElementById('gold-calc-rate');
    if (rateInput) rateInput.dataset.userEdited = '';
    applyCalcRateField();
    updateGoldCalculator();
  });
  updateGoldCalculator();
}

const quickCalcState = {
  display: '0',
  accumulator: null,
  operator: null,
  fresh: true
};

function resetQuickCalc() {
  quickCalcState.display = '0';
  quickCalcState.accumulator = null;
  quickCalcState.operator = null;
  quickCalcState.fresh = true;
  renderQuickCalcDisplay();
}

function renderQuickCalcDisplay() {
  const el = document.getElementById('quick-calc-display');
  if (el) el.textContent = quickCalcState.display;
}

function formatQuickCalcResult(value) {
  if (!Number.isFinite(value)) return 'Error';
  const rounded = Math.round(value * 1e10) / 1e10;
  const text = String(rounded);
  return text.length > 14 ? rounded.toPrecision(12).replace(/\.?0+$/, '') : text;
}

function applyQuickCalcOp(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function quickCalcInputDigit(digit) {
  if (quickCalcState.display === 'Error') resetQuickCalc();
  if (quickCalcState.fresh) {
    quickCalcState.display = digit === '.' ? '0.' : digit;
    quickCalcState.fresh = false;
  } else if (digit === '.') {
    if (!quickCalcState.display.includes('.')) quickCalcState.display += '.';
  } else if (quickCalcState.display === '0') {
    quickCalcState.display = digit;
  } else {
    quickCalcState.display += digit;
  }
  renderQuickCalcDisplay();
}

function quickCalcSetOperator(op) {
  if (quickCalcState.display === 'Error') return;
  const current = Number(quickCalcState.display);
  if (quickCalcState.operator != null && quickCalcState.accumulator != null && !quickCalcState.fresh) {
    const result = applyQuickCalcOp(quickCalcState.accumulator, current, quickCalcState.operator);
    quickCalcState.display = formatQuickCalcResult(result);
    quickCalcState.accumulator = Number(quickCalcState.display);
  } else if (quickCalcState.accumulator == null || quickCalcState.fresh) {
    quickCalcState.accumulator = current;
  }
  quickCalcState.operator = op;
  quickCalcState.fresh = true;
  renderQuickCalcDisplay();
}

function quickCalcEquals() {
  if (quickCalcState.display === 'Error') return;
  if (quickCalcState.operator == null || quickCalcState.accumulator == null) return;
  const current = Number(quickCalcState.display);
  const result = applyQuickCalcOp(quickCalcState.accumulator, current, quickCalcState.operator);
  quickCalcState.display = formatQuickCalcResult(result);
  quickCalcState.accumulator = null;
  quickCalcState.operator = null;
  quickCalcState.fresh = true;
  renderQuickCalcDisplay();
}

function quickCalcBackspace() {
  if (quickCalcState.fresh || quickCalcState.display === 'Error') return;
  quickCalcState.display = quickCalcState.display.length <= 1
    ? '0'
    : quickCalcState.display.slice(0, -1);
  renderQuickCalcDisplay();
}

function handleQuickCalcPadClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'digit') quickCalcInputDigit(btn.dataset.digit);
  else if (action === 'op') quickCalcSetOperator(btn.dataset.op);
  else if (action === 'equals') quickCalcEquals();
  else if (action === 'clear') resetQuickCalc();
  else if (action === 'backspace') quickCalcBackspace();
}

function handleQuickCalcKeydown(e) {
  const modal = document.getElementById('quick-calc-modal');
  if (!modal?.open) return;
  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    quickCalcInputDigit(e.key);
  } else if (e.key === '.') {
    e.preventDefault();
    quickCalcInputDigit('.');
  } else if (e.key === '+') {
    e.preventDefault();
    quickCalcSetOperator('+');
  } else if (e.key === '-') {
    e.preventDefault();
    quickCalcSetOperator('-');
  } else if (e.key === '*') {
    e.preventDefault();
    quickCalcSetOperator('*');
  } else if (e.key === '/') {
    e.preventDefault();
    quickCalcSetOperator('/');
  } else if (e.key === 'Enter' || e.key === '=') {
    e.preventDefault();
    quickCalcEquals();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    quickCalcBackspace();
  } else if (e.key === 'Escape') {
    modal.close();
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    resetQuickCalc();
  }
}

function openQuickCalcModal() {
  const modal = document.getElementById('quick-calc-modal');
  if (!modal) return;
  resetQuickCalc();
  modal.showModal();
}

function initQuickCalculator() {
  document.getElementById('open-quick-calc-btn')?.addEventListener('click', openQuickCalcModal);
  document.getElementById('close-quick-calc-modal')?.addEventListener('click', () => {
    document.getElementById('quick-calc-modal')?.close();
  });
  document.getElementById('quick-calc-pad')?.addEventListener('click', handleQuickCalcPadClick);
  document.getElementById('quick-calc-modal')?.addEventListener('cancel', (e) => {
    e.preventDefault();
    e.target.close();
  });
  document.addEventListener('keydown', handleQuickCalcKeydown);
}

let orderModalContext = 'order';

function updateOrderModalChrome() {
  const isPos = orderModalContext === 'pos';
  const title = document.getElementById('order-modal-title');
  const submitBtn = document.getElementById('order-submit-btn');
  const segment = document.querySelector('#order-modal .order-item-mode');
  if (title) title.textContent = t(isPos ? 'addCustomItemTitle' : 'addOrderTitle');
  if (submitBtn) submitBtn.textContent = t(isPos ? 'addToCart' : 'createOrder');
  if (segment) segment.hidden = isPos;
}

function isOrderCustomItemMode(form) {
  const mode = form?.elements.orderItemMode?.value;
  return mode === 'custom';
}

function setOrderItemMode(form, mode) {
  if (!form) return;
  const inventoryFields = document.getElementById('order-inventory-fields');
  const customFields = document.getElementById('order-custom-fields');
  const itemSelect = form.elements.itemId;
  const modeInput = form.elements.orderItemMode;
  const isCustom = mode === 'custom';
  if (modeInput) modeInput.value = isCustom ? 'custom' : 'inventory';
  if (inventoryFields) inventoryFields.hidden = isCustom;
  if (customFields) customFields.hidden = !isCustom;
  form.querySelectorAll('[data-order-item-mode]').forEach((btn) => {
    const active = btn.dataset.orderItemMode === (isCustom ? 'custom' : 'inventory');
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (itemSelect) itemSelect.required = !isCustom;
  syncItemMetalFields(form, METAL_FIELD_PRESETS.order);
  const customWeightEntry = getWeightEntryEl(form, 'custom');
  if (customWeightEntry) {
    customWeightEntry.querySelectorAll('input').forEach((input) => {
      input.required = isCustom && (input.name === 'customWeightGrams' || getWeightUnit(form, 'custom') === 'tola');
    });
  }
  updateOrderTotalPreview();
  updateOrderItemWeightPreview();
}

function itemMetalType(itemOrCategory) {
  const slug = typeof itemOrCategory === 'string'
    ? itemOrCategory
    : String(itemOrCategory?.category || '').trim().toLowerCase();
  if (slug === 'silver') return 'silver';
  if (slug === 'other') return 'other';
  return 'gold';
}

const METAL_TYPES = ['Gold', 'Silver', 'Other'];

const METAL_FIELD_PRESETS = {
  inventory: { category: 'category', karat: 'karat', customRate: 'customRatePerTola', name: 'name', requireNameForOther: false },
  customItem: { category: 'category', karat: 'karat', customRate: 'customRatePerTola', name: 'name', requireNameForOther: true },
  order: { category: 'customCategory', karat: 'customKarat', customRate: 'customRatePerTola', name: 'customItemName', requireNameForOther: true }
};

function resolveCustomItemName(category, providedName) {
  const trimmed = String(providedName || '').trim();
  if (trimmed) return trimmed;
  if (itemMetalType(category) === 'other') return '';
  return categoryLabel(category || 'gold');
}

function validateCustomItemName(category, name) {
  if (itemMetalType(category) === 'other' && !String(name || '').trim()) {
    toast(t('itemNameOtherRequired'));
    return false;
  }
  return true;
}

function validateOtherMetalRate(category, rate) {
  if (itemMetalType(category) === 'other' && !(Number(rate) > 0)) {
    toast(t('itemManualRateRequired'));
    return false;
  }
  return true;
}

function lineMetalLabel(line) {
  return categoryLabel(line.category || line.item?.category || 'gold');
}

function calcJartiAmount({ jartiRateType = 'flat', jartiRateValue = 0, weightGrams = 0, metalValue = 0, ratePerTola = 0, karatFactor = 1 } = {}) {
  const value = Number(jartiRateValue) || 0;
  if (value <= 0) return 0;
  const grams = Number(weightGrams) || 0;
  const metal = Number(metalValue) || 0;
  const type = String(jartiRateType || 'flat');

  // Order-style jarti: charge jarti weight at the metal rate
  if (type === 'percent' || type === 'grams') {
    const jartiGrams = resolveJartiWeightGrams(grams, type, value);
    if (jartiGrams <= 0 || !(Number(ratePerTola) > 0)) {
      // Fallback: percent of metal value when rate missing
      if (type === 'percent' && metal > 0) return (metal * value) / 100;
      return 0;
    }
    return jartiGrams * (Number(ratePerTola) / TOLA_GRAMS) * (Number(karatFactor) || 1);
  }

  switch (type) {
    case 'per_gram':
      return grams > 0 ? value * grams : 0;
    case 'per_tola':
      return grams > 0 ? value * (grams / TOLA_GRAMS) : 0;
    case 'flat':
    default:
      return value;
  }
}

function resolveJartiWeightGrams(weightGrams, jartiRateType = 'percent', jartiRateValue = 0) {
  const value = Number(jartiRateValue) || 0;
  if (value <= 0) return 0;
  const grams = Number(weightGrams) || 0;
  if (String(jartiRateType) === 'grams' || String(jartiRateType) === 'weight') return value;
  if (String(jartiRateType) === 'percent') return grams > 0 ? (grams * value) / 100 : 0;
  return 0;
}

function getOrderJartiGramsFromForm(form) {
  if (!form) return 0;
  const type = form.customJartiRateType?.value || 'percent';
  if (type === 'percent') {
    const weightGrams = getWeightGramsFromForm(form, 'custom');
    return resolveJartiWeightGrams(weightGrams, 'percent', Number(form.customJartiRateValue?.value) || 0);
  }
  const weightUnit = getWeightUnit(form, 'custom');
  if (weightUnit === 'tola') {
    return tolaPartsToGrams(
      form.customJartiTola?.value,
      form.customJartiAana?.value,
      form.customJartiLaal?.value
    );
  }
  return Number(form.customJartiGrams?.value) || 0;
}

function syncOrderJartiPanels(form = document.getElementById('order-form'), { clearInactive = false } = {}) {
  if (!form) return;
  const type = form.customJartiRateType?.value || 'percent';
  const weightUnit = getWeightUnit(form, 'custom');
  const isPercent = type === 'percent';
  const isTola = !isPercent && weightUnit === 'tola';
  const isGrams = !isPercent && !isTola;

  const percentWrap = document.getElementById('order-jarti-percent-wrap');
  if (percentWrap) percentWrap.hidden = !isPercent;

  form.querySelectorAll('.order-jarti-grams-wrap').forEach((el) => el.toggleAttribute('hidden', !isGrams));
  form.querySelectorAll('.order-jarti-tola-wrap').forEach((el) => el.toggleAttribute('hidden', !isTola));
  form.querySelectorAll('.order-jarti-aana-wrap').forEach((el) => el.toggleAttribute('hidden', !isTola));
  form.querySelectorAll('.order-jarti-laal-wrap').forEach((el) => el.toggleAttribute('hidden', !isTola));

  const label = document.getElementById('order-jarti-value-label');
  if (label) label.textContent = 'Jarti %';

  if (clearInactive) {
    if (isPercent || isGrams) {
      if (form.customJartiTola) form.customJartiTola.value = '';
      if (form.customJartiAana) form.customJartiAana.value = '';
      if (form.customJartiLaal) form.customJartiLaal.value = '';
    }
    if (isPercent || isTola) {
      if (form.customJartiGrams) form.customJartiGrams.value = '';
    }
    if (!isPercent && form.customJartiRateValue) form.customJartiRateValue.value = '0';
  }
}

function syncOrderJartiLabels(form = document.getElementById('order-form')) {
  syncOrderJartiPanels(form);
}

function updateOrderJartiPreview(form, {
  weightGrams = 0,
  ratePerTola = 0,
  karatFactor = 1,
  jartiRateType = 'percent',
  jartiRateValue = 0,
  jartiWeightGrams = null
} = {}) {
  const preview = document.getElementById('order-jarti-preview');
  if (!preview) return;
  const jartiGrams = jartiWeightGrams != null
    ? Number(jartiWeightGrams) || 0
    : resolveJartiWeightGrams(weightGrams, jartiRateType, jartiRateValue);
  if (jartiGrams <= 0) {
    const unit = getWeightUnit(form, 'custom');
    preview.textContent = unit === 'tola'
      ? 'Jarti is optional. For fixed weight in tola mode, enter jarti as tola / aana / laal — priced at the metal rate.'
      : 'Jarti is optional. Enter % of net weight or fixed grams — priced at the current metal rate.';
    return;
  }
  const rateGram = (Number(ratePerTola) || 0) / TOLA_GRAMS;
  const jartiPrice = jartiGrams * rateGram * (Number(karatFactor) || 1);
  const rateText = rateGram > 0
    ? `${formatMoney(rateGram)}/g · ${formatMoney(ratePerTola)}/tola`
    : 'set metal rate in Settings';
  const parts = gramsToTolaParts(jartiGrams);
  const tolaHint = parts.tola || parts.aana || parts.laal
    ? ` (${parts.tola} tola ${parts.aana} aana ${formatWeightQty(parts.laal, 2)} laal)`
    : '';
  preview.innerHTML = `<strong>Jarti weight:</strong> ${formatWeightQty(jartiGrams, 4)} g${tolaHint} · <strong>Rate:</strong> ${rateText} · <strong>Jarti price:</strong> ${rateGram > 0 ? formatMoney(jartiPrice) : '—'}`;
}

function metalValueFromWeight(weightGrams, ratePerTola, weightUnit = 'grams', tolaParts = null, karatFactor = 1) {
  if (!ratePerTola || !weightGrams) return 0;
  let metalValue;
  if (weightUnit === 'tola' && tolaParts) {
    metalValue = calcGoldMetalNpr({ grams: weightGrams, unit: 'tola', tolaParts, ratePerTolaNpr: ratePerTola });
  } else {
    metalValue = (weightGrams / TOLA_GRAMS) * ratePerTola;
  }
  return metalValue * karatFactor;
}

function calcItemLinePrice(itemDraft, { weightUnit = 'grams', tolaParts = null, rates = null } = {}) {
  const metal = itemMetalType(itemDraft);
  const weightGrams = Number(itemDraft.weightGrams) || 0;
  const making = Number(itemDraft.makingCharge) || 0;
  if (!weightGrams) return null;

  let rate = 0;
  let karatFactor = 1;
  if (metal === 'silver') {
    rate = rates?.silverRatePerTola ?? silverRateCache ?? 0;
  } else if (metal === 'other') {
    rate = Number(itemDraft.customRatePerTola) || 0;
    if (!rate) {
      const sale = Number(itemDraft.salePrice);
      if (sale > 0) return Math.round(sale);
      return Math.round(making);
    }
  } else {
    rate = rates?.goldRatePerTola ?? getGoldRatePerTolaNpr();
    karatFactor = (Number(itemDraft.karat) || 24) / 24;
  }

  const metalValue = metalValueFromWeight(weightGrams, rate, weightUnit, tolaParts, karatFactor);
  const jarti = calcJartiAmount({
    jartiRateType: itemDraft.jartiRateType,
    jartiRateValue: itemDraft.jartiRateValue,
    weightGrams,
    metalValue,
    ratePerTola: rate,
    karatFactor
  });
  return Math.round(metalValue + making + jarti);
}

function itemMarketValue(item, rates = null) {
  return calcItemLinePrice(item, { weightUnit: 'grams', rates });
}

function calcGoldPriceNpr(weightGrams, makingChargeNpr = 0, unit = 'grams', tolaParts = null, ratePerTolaNpr = getGoldRatePerTolaNpr()) {
  const metal = calcGoldMetalNpr({ grams: weightGrams, unit, tolaParts, ratePerTolaNpr });
  if (metal <= 0) return 0;
  return metal + (Number(makingChargeNpr) || 0);
}

function itemPriceFromForm(form, prefix = '') {
  const weightGrams = getWeightGramsFromForm(form, prefix);
  const weightUnit = getWeightUnit(form, prefix);
  const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, prefix) : null;
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;

  return calcItemLinePrice({
    category: form.elements.category?.value || 'gold',
    karat: Number(form.elements.karat?.value) || 24,
    weightGrams,
    makingCharge: parseMoneyField(form.makingCharge?.value) || 0,
    customRatePerTola: parseMoneyField(form.customRatePerTola?.value) || 0,
    salePrice: parseMoneyField(form.salePrice?.value)
  }, { weightUnit, tolaParts });
}

function getItemCalculatedPriceNpr(item) {
  return itemMarketValue(item);
}

function syncItemMetalFields(form, fields = METAL_FIELD_PRESETS.inventory) {
  if (!form) return;
  const categoryField = fields.category || 'category';
  const karatField = fields.karat || 'karat';
  const customRateField = fields.customRate || 'customRatePerTola';
  const metal = itemMetalType(form.elements[categoryField]?.value || 'gold');
  const karatEl = form.elements[karatField];
  const karatLabel = karatEl?.closest('label') || form.querySelector(`label:has([name="${karatField}"])`);
  const customRateLabel = form.querySelector('.item-custom-rate-field');
  const rateHint = form.querySelector('.item-metal-rate-hint');

  if (karatLabel) karatLabel.hidden = metal !== 'gold';
  if (customRateLabel) customRateLabel.hidden = metal !== 'other';

  if (fields.name) {
    const nameEl = form.elements[fields.name];
    if (fields.requireNameForOther && nameEl) nameEl.required = metal === 'other';
    const placeholderKey = metal === 'other'
      ? 'itemNameOtherPh'
      : (fields.requireNameForOther ? 'itemNameOptionalPh' : '');
    if (nameEl?.dataset.i18nPlaceholder) {
      nameEl.placeholder = placeholderKey ? t(placeholderKey) : '';
    }
  }

  if (rateHint) {
    if (metal === 'gold') {
      const rate = getGoldRatePerTolaNpr();
      rateHint.textContent = rate > 0
        ? `${t('itemUsesGoldRate')}: ${formatMoney(rate)}/tola`
        : t('itemUsesGoldRate');
      rateHint.hidden = false;
    } else if (metal === 'silver') {
      const rate = silverRateCache || 0;
      rateHint.textContent = rate > 0
        ? `${t('itemUsesSilverRate')}: ${formatMoney(rate)}/tola`
        : t('itemUsesSilverRate');
      rateHint.hidden = false;
    } else {
      rateHint.hidden = true;
    }
  }
}

function getItemDisplayPrice(item) {
  const manual = Number(item.salePrice);
  if (Number.isFinite(manual) && manual > 0) return manual;
  return getItemCalculatedPriceNpr(item);
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.classList.remove('toast-error');
  el.classList.toggle('toast-error', type === 'error');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, type === 'error' ? 4000 : 2600);
}

function errorToast(title, msg) {
  const el = document.getElementById('toast');
  el.classList.add('toast-error');
  el.innerHTML = `<strong>${title}</strong><span>${msg}</span>`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshAll().catch((err) => {
      if (typeof toast === 'function') toast(err.message);
    });
  }, 150);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

  const method = String(opts.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isAuth = path.startsWith('/api/auth');

  if (isMutation && !isAuth) await requireSignedIn();

  if (typeof getAuthAccessToken === 'function') {
    const token = await getAuthAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...opts,
    headers
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // The token is dead; drop it so background pollers stop sending it.
    try { localStorage.removeItem('sp_auth_token'); } catch (_) { /* ignore */ }
    if (typeof redirectToLogin === 'function') redirectToLogin();
    throw new Error(data.error || 'Sign in required.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  const skipRefresh = path.includes('/api/settings/daily-gold-rate')
    || path.includes('/api/shared/gold-rates')
    || path.includes('/api/customers');
  if (isMutation && !isAuth && !skipRefresh) scheduleRefresh();
  return data;
}

function formatCurrencyAmount(amount) {
  const c = getCurrency();
  if (!moneyFormatters[c.code]) {
    moneyFormatters[c.code] = new Intl.NumberFormat(c.locale, {
      style: 'currency',
      currency: c.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    });
  }
  return moneyFormatters[c.code].format(Number(amount) || 0);
}

function applyMetalRatesFromResponse(payload) {
  if (effectivePriceMode() === 'manual') {
    applyManualRatesToApp(resolveManualMetalRates());
    return;
  }
  if (payload.metalRatesLive) {
    if (payload.goldRatePerTola != null) goldRateCache = displayToNpr(payload.goldRatePerTola);
    if (payload.silverRatePerTola != null) silverRateCache = displayToNpr(payload.silverRatePerTola);
    return;
  }
  if (payload.goldRatePerTola != null) goldRateCache = payload.goldRatePerTola;
  if (payload.silverRatePerTola != null) silverRateCache = payload.silverRatePerTola;
}

function itemStockStatusBadge(item) {
  if (!item || item.quantity === 0) return `<span class="badge sold">${t('soldOut')}</span>`;
  return `<span class="badge">${t('inStock')}</span>`;
}

function txTypeLabel(type) {
  if (type === 'stock_in') return t('stockIn');
  if (type === 'sale') return t('sale');
  return t('stockOut');
}

function orderStatusBadge(status) {
  if (status === 'cancelled') {
    return `<span class="badge order-cancelled">${t('orderCancelled')}</span>`;
  }
  const groupId = orderGroupIdForStatus(status);
  const group = ORDER_GROUPS.find((g) => g.id === groupId);
  if (!group) return `<span class="badge order-new">${t('orderNew')}</span>`;
  return `<span class="badge order-${group.id}">${t(group.labelKey)}</span>`;
}

function orderCancelButton(id) {
  return `<button type="button" class="link-btn danger" data-order-action="cancelled" data-order-id="${escapeHtml(id)}">${t('cancelOrder')}</button>`;
}

function orderActionButtons(order) {
  const actions = [];
  const id = order.id;
  if (order.status === 'completed') {
    actions.push(`<button type="button" class="order-cart-btn" data-order-cart="${escapeHtml(id)}" title="${t('addCart')}" aria-label="${t('addCart')}">${cartIcon()}</button>`);
  }
  const currentGroup = orderGroupIdForStatus(order.status);
  for (const group of ORDER_GROUPS) {
    const targetStatus = orderGroupTargetStatus(group.id);
    const isCurrent = currentGroup === group.id;
    const revert = order.status === 'completed' && group.id !== 'completed';
    actions.push(
      `<button type="button" class="link-btn order-status-btn${isCurrent ? ' is-current' : ''}" data-order-action="${targetStatus}" data-order-id="${escapeHtml(id)}"${revert ? ' data-order-revert="completed"' : ''}${isCurrent ? ' disabled aria-current="true"' : ''}>${t(group.labelKey)}</button>`
    );
  }
  if (order.status !== 'cancelled') {
    actions.push(orderCancelButton(id));
  }
  return actions.join('');
}

// Gold and silver come from the rates saved in Settings — nothing is fetched.
async function updateMetalRates(settings = {}) {
  const bodyEl = document.getElementById('metal-rates-body');
  const rateEdit = document.querySelector('.rate-edit');
  settingsPriceMode = PRICE_MODE;

  if (bodyEl) bodyEl.hidden = true;
  const metal = resolveManualMetalRates(settings);
  applyManualRatesToApp(metal);
  if (rateEdit) rateEdit.hidden = false;
  refreshMetalPriceFields();
  updateGoldCalculator();
  updateOrderTotalPreview();
}

function updateMetalRatePreviews() {
  syncSettingsGoldRateFromGram();
  syncSettingsSilverRateFromGram();
}

function renderLocationDatalist() {
  const list = document.getElementById('location-options');
  if (!list) return;
  list.innerHTML = '';
  locationsCache.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = loc;
    list.appendChild(opt);
  });
}

function renderLocationsManager() {
  const list = document.getElementById('locations-list');
  if (!list) return;
  if (!locationsCache.length) {
    list.innerHTML = `<li class="location-empty">${t('noLocations')}</li>`;
    return;
  }
  list.innerHTML = locationsCache.map((loc, idx) => `
    <li class="location-tag">
      <span>${escapeHtml(loc)}</span>
      <button type="button" class="location-remove" data-remove-location="${idx}" title="${t('delete')}" aria-label="${t('delete')}">×</button>
    </li>`).join('');
}

async function saveStoreLocations() {
  const snapshot = [...locationsCache];
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ locations: snapshot })
  });
  renderLocationDatalist();
  renderLocationsManager();
}

async function addStoreLocation(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    toast(t('locationNameRequired'));
    return;
  }
  if (locationsCache.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
    toast(t('locationExists'));
    return;
  }
  locationsCache = [...locationsCache, trimmed];
  renderLocationsManager();
  toast(t('locationAdded'));
  const input = document.getElementById('new-location-input');
  if (input) input.value = '';
}

async function removeStoreLocation(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= locationsCache.length) return;
  locationsCache = locationsCache.filter((_, i) => i !== idx);
  renderLocationsManager();
  toast(t('locationRemoved'));
}

async function persistStoreLocations() {
  const previous = [...locationsCache];
  try {
    await saveStoreLocations();
    toast(t('locationsSaved'));
  } catch (err) {
    locationsCache = previous;
    renderLocationsManager();
    toast(err.message);
  }
}

function generateSku(prefix = 'SKU') {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

function renderCategorySelect(select, { includeAll = false, defaultValue = 'gold' } = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';
  if (includeAll) {
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = t('allCategories');
    select.appendChild(allOpt);
  }
  itemCategoriesCache.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = categorySlug(name);
    opt.textContent = categoryOptionLabel(name);
    select.appendChild(opt);
  });
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  } else if (!includeAll && [...select.options].some((o) => o.value === defaultValue)) {
    select.value = defaultValue;
  }
}

function ensureCategoryOption(select, value) {
  if (!select || !value) return;
  if ([...select.options].some((o) => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = categoryLabel(value);
  select.appendChild(opt);
}

function renderAllCategorySelects() {
  renderCategorySelect(document.getElementById('pos-filter-category'), { includeAll: true });
  renderCategorySelect(document.querySelector('#item-form select[name="category"]'));
  renderCategorySelect(document.querySelector('#custom-item-form select[name="category"]'));
  renderCategorySelect(document.querySelector('#order-form select[name="customCategory"]'));
  syncItemMetalFields(document.getElementById('item-form'), METAL_FIELD_PRESETS.inventory);
  syncItemMetalFields(document.getElementById('custom-item-form'), METAL_FIELD_PRESETS.customItem);
  syncItemMetalFields(document.getElementById('order-form'), METAL_FIELD_PRESETS.order);
}

function renderItemCategoriesManager() {
  const list = document.getElementById('item-categories-list');
  if (!list) return;
  if (!itemCategoriesCache.length) {
    list.innerHTML = `<li class="location-empty">${t('noCategories')}</li>`;
    return;
  }
  const protectedSlugs = new Set(['gold', 'silver', 'other']);
  list.innerHTML = itemCategoriesCache.map((cat, idx) => {
    const isProtected = protectedSlugs.has(categorySlug(cat));
    const removeBtn = isProtected
      ? ''
      : `<button type="button" class="location-remove" data-remove-category="${idx}" title="${t('delete')}" aria-label="${t('delete')}">×</button>`;
    return `
    <li class="location-tag">
      <span>${escapeHtml(categoryOptionLabel(cat))}</span>
      ${removeBtn}
    </li>`;
  }).join('');
}

async function saveStoreItemCategories() {
  const snapshot = [...itemCategoriesCache];
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ itemCategories: snapshot })
  });
  setItemCategoryNames(snapshot);
  renderAllCategorySelects();
  renderItemCategoriesManager();
}

async function addStoreCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    toast(t('categoryNameRequired'));
    return;
  }
  if (itemCategoriesCache.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
    toast(t('categoryExists'));
    return;
  }
  itemCategoriesCache = [...itemCategoriesCache, trimmed];
  renderItemCategoriesManager();
  toast(t('categoryAdded'));
  const input = document.getElementById('new-category-input');
  if (input) input.value = '';
}

async function removeStoreCategory(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= itemCategoriesCache.length) return;
  const protectedSlugs = new Set(['gold', 'silver', 'other']);
  if (protectedSlugs.has(categorySlug(itemCategoriesCache[idx]))) return;
  itemCategoriesCache = itemCategoriesCache.filter((_, i) => i !== idx);
  renderItemCategoriesManager();
  toast(t('categoryRemoved'));
}

async function persistStoreItemCategories() {
  const previous = [...itemCategoriesCache];
  try {
    await saveStoreItemCategories();
    toast(t('categoriesSaved'));
  } catch (err) {
    itemCategoriesCache = previous;
    setItemCategoryNames(previous);
    renderAllCategorySelects();
    renderItemCategoriesManager();
    toast(err.message);
  }
}

let shopNameCheckTimer = null;

function renderShopNameStatus({ available, checking, unchanged } = {}) {
  const el = document.getElementById('shop-name-status');
  const input = document.getElementById('settings-shop-name');
  if (!el || !input) return;
  if (unchanged) {
    el.hidden = true;
    el.textContent = '';
    input.setCustomValidity('');
    return;
  }
  if (checking) {
    el.hidden = false;
    el.textContent = '…';
    el.className = 'form-hint shop-name-status';
    input.setCustomValidity('');
    return;
  }
  if (available) {
    el.hidden = false;
    el.textContent = t('shopNameAvailable');
    el.className = 'form-hint shop-name-status is-available';
    input.setCustomValidity('');
  } else {
    el.hidden = false;
    el.textContent = t('shopNameTaken');
    el.className = 'form-hint shop-name-status is-taken';
    input.setCustomValidity(t('shopNameTaken'));
  }
}

async function checkShopNameAvailability(name) {
  const trimmed = String(name || '').trim();
  const current = String(settingsCache.shopName || '').trim();
  if (!trimmed || trimmed.toLowerCase() === current.toLowerCase()) {
    renderShopNameStatus({ unchanged: true });
    return true;
  }
  renderShopNameStatus({ checking: true });
  try {
    const payload = await api(`/api/settings/shop-name-available?name=${encodeURIComponent(trimmed)}`);
    renderShopNameStatus({ available: Boolean(payload.available) });
    return Boolean(payload.available);
  } catch (_) {
    renderShopNameStatus({ unchanged: true });
    return true;
  }
}

function scheduleShopNameCheck(name) {
  clearTimeout(shopNameCheckTimer);
  shopNameCheckTimer = setTimeout(() => {
    checkShopNameAvailability(name).catch(() => renderShopNameStatus({ unchanged: true }));
  }, 350);
}

function updateShopBranding(view = activeView) {
  const shop = settingsCache.shopName || 'Suvarnapasal';
  const brandEl = document.getElementById('brand-shop-name');
  if (brandEl) brandEl.textContent = shop;
  const brandLogo = document.querySelector('.brand .brand-logo');
  if (brandLogo) brandLogo.alt = shop;

  const viewTitles = {
    pos: t('navPOS'),
    inventory: t('navInventory'),
    orders: t('navOrders'),
    customers: t('navCustomers'),
    reports: t('navReports'),
    expenses: t('navExpenses'),
    calculator: t('navCalculator'),
    settings: t('viewSettingsTitle')
  };
  const section = viewTitles[view] || view;
  document.title = `${shop} — ${section}`;
}

async function loadSettings() {
  const settings = await api('/api/settings');
  // The shop location is a MANUAL choice — no auto-detection. Until the user
  // picks one (Settings → Store Information → Shop location, or the Display
  // currency dropdown), the app stays on the Nepal defaults. The choice is
  // kept on the server and mirrored in this browser (localStorage), so an
  // older backend that doesn't store 'country' can't lose it on refresh.
  const serverCountry = SHOP_COUNTRIES[settings.country] ? settings.country : null;
  const savedCountry = storedShopCountry() || serverCountry;
  const shopCountryResolved = savedCountry || 'NP';
  if (savedCountry) rememberShopCountry(shopCountryResolved);
  settingsCache = {
    shopName: settings.shopName || 'Suvarnapasal',
    shopAddress: settings.shopAddress || '',
    shopPhone: settings.shopPhone || '',
    shopPan: settings.shopPan || '',
    vatRate: settings.vatRate != null ? Number(settings.vatRate) : 13,
    country: shopCountryResolved,
    salesTaxRate: settings.salesTaxRate != null ? Number(settings.salesTaxRate) : 0,
    calendarMode: settings.calendarMode || 'both',
    priceMode: PRICE_MODE,
    currency: settings.currency || 'NPR',
    goldRatePerTola: settings.goldRatePerTola,
    goldBuyRatePerTola: settings.goldBuyRatePerTola || 0,
    silverRatePerTola: settings.silverRatePerTola,
    fxRates: settings.fxRates || { USD: 133, CAD: 98 },
    fxUpdatedAt: settings.fxUpdatedAt || null
  };
  // Keep client-side currency conversion in sync with the shop's configured FX rates.
  if (settingsCache.fxRates.USD > 0) CURRENCIES.USD.nprPerUnit = Number(settingsCache.fxRates.USD);
  if (settingsCache.fxRates.CAD > 0) CURRENCIES.CAD.nprPerUnit = Number(settingsCache.fxRates.CAD);
  const fxUsdInput = document.getElementById('settings-fx-usd');
  const fxCadInput = document.getElementById('settings-fx-cad');
  if (fxUsdInput && !fxUsdInput.matches(':focus')) fxUsdInput.value = settingsCache.fxRates.USD || '';
  if (fxCadInput && !fxCadInput.matches(':focus')) fxCadInput.value = settingsCache.fxRates.CAD || '';
  const fxHint = document.getElementById('fx-updated-hint');
  if (fxHint) {
    fxHint.hidden = !settingsCache.fxUpdatedAt;
    if (settingsCache.fxUpdatedAt) fxHint.textContent = `${t('fxLastUpdated')}: ${new Date(settingsCache.fxUpdatedAt).toLocaleString()}`;
  }
  // The currency chosen on this computer wins over whatever the server says —
  // an old backend that drops the setting can never snap it back to USD.
  const localCurrency = storedDisplayCurrency();
  setDisplayCurrency(localCurrency || settings.currency || 'NPR');
  if (localCurrency) settingsCache.currency = localCurrency;
  // The user picked a country earlier but the server doesn't have it yet
  // (older backend or a missed save) — persist it again, quietly.
  if (savedCountry && !serverCountry) {
    api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ country: shopCountryResolved })
    }).catch(() => { /* best-effort */ });
  }
  initCurrencySelect();
  const storeForm = document.getElementById('settings-store-form');
  const priceForm = document.getElementById('settings-form');
  if (storeForm) {
    // Never rewrite a field the user is typing in (it makes the box flicker
    // and eats the keystrokes when settings reload in the background).
    if (!storeForm.shopName.matches(':focus')) storeForm.shopName.value = settings.shopName || 'Suvarnapasal';
    if (!storeForm.shopAddress.matches(':focus')) storeForm.shopAddress.value = settings.shopAddress || '';
    if (!storeForm.shopPhone.matches(':focus')) storeForm.shopPhone.value = settings.shopPhone || '';
    if (storeForm.shopPan && !storeForm.shopPan.matches(':focus')) storeForm.shopPan.value = settings.shopPan || '';
    if (storeForm.vatRate) storeForm.vatRate.value = settings.vatRate != null ? settings.vatRate : 13;
    if (storeForm.country) storeForm.country.value = settingsCache.country;
    if (storeForm.salesTaxRate) storeForm.salesTaxRate.value = settingsCache.salesTaxRate > 0 ? settingsCache.salesTaxRate : '';
    if (storeForm.calendarMode) storeForm.calendarMode.value = settings.calendarMode || 'both';
    renderShopNameStatus({ unchanged: true });
  }
  applyShopCountryUi();
  if (priceForm) {
    // Manual is the only mode now; keep any leftover radio in sync.
    priceForm.querySelectorAll('[name="priceMode"]').forEach((r) => {
      r.checked = r.value === PRICE_MODE;
    });
  }
  goldRateCache = settings.goldRatePerTola;
  goldBuyRateCache = settings.goldBuyRatePerTola
    || (settings.goldBuyRatePerGram
      ? Number((settings.goldBuyRatePerGram * TOLA_GRAMS).toFixed(2))
      : 0);
  silverRateCache = settings.silverRatePerTola
    || (settings.silverRatePerGram
      ? Number((settings.silverRatePerGram * TOLA_GRAMS).toFixed(2))
      : 0);
  settingsCache.goldRatePerTola = goldRateCache;
  settingsCache.goldBuyRatePerTola = goldBuyRateCache;
  settingsCache.silverRatePerTola = silverRateCache;
  rateHistoryCache = (settings.rateHistory || []).map(normalizeRateHistoryRow);
  await loadSharedGoldRates();
  refreshMetalPriceFields();
  await updateMetalRates(settings);
  await ensureTodayGoldRateInDatabase();

  locationsCache = settings.locations || [];
  renderLocationDatalist();
  renderLocationsManager();

  itemCategoriesCache = [...METAL_TYPES];
  setItemCategoryNames(itemCategoriesCache);
  renderAllCategorySelects();
  renderItemCategoriesManager();

  document.getElementById('settings-updated').textContent = settings.updatedAt
    ? `${t('lastSaved')} ${new Date(settings.updatedAt).toLocaleString()}`
    : '';

  renderRateHistoryChart();
  renderRateHistoryTable();
  renderLiveDailyRateNow();
  syncMetalRatePolling();
  updateShopBranding();
  startRateSync();
}

function showView(name) {
  activeView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  const viewEl = document.getElementById(`view-${name}`);
  if (viewEl) viewEl.hidden = false;

  document.querySelectorAll('.nav-btn, .settings-nav-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === name);
  });

  const meta = views[name] || views.pos;
  const addBtn = document.getElementById('add-item-btn');
  if (addBtn) addBtn.hidden = !meta.showAddItem;

  updateShopBranding(name);

  if (name !== 'calculator') document.getElementById('quick-calc-modal')?.close();

  syncMarketPricePolling();

  if (name === 'orders') {
    if (ordersAllCache.length) renderOrdersView();
    else loadOrders().catch(() => {});
  }
  if (name === 'reports') {
    loadReports().catch((e) => toast(e.message));
  }
  if (name === 'calculator') {
    initGoldCalculator();
    updateGoldCalculator();
  }
  if (name === 'customers') {
    loadCustomers().catch(() => {});
  }
  if (name === 'karigar') {
    Promise.all([
      typeof loadKarigars === 'function' ? loadKarigars() : Promise.resolve(),
      typeof loadOrders === 'function' ? loadOrders() : Promise.resolve()
    ]).catch(() => {});
  }
  if (name === 'dashboard' && typeof loadDashboard === 'function') {
    loadDashboard().catch((e) => toast(e.message));
  }
  if (name === 'repairs' && typeof loadRepairs === 'function') {
    loadRepairs().catch((e) => toast(e.message));
  }
  if (name === 'schemes' && typeof loadSchemes === 'function') {
    loadSchemes().catch((e) => toast(e.message));
  }
  if (name === 'requests' && typeof loadRequests === 'function') {
    loadRequests().catch((e) => toast(e.message));
  }
  syncMetalRatePolling();
  syncCustomersPolling();
}

function cartLineName(line) {
  const name = line.name || line.itemName || '';
  if (name) return name;
  return lineMetalLabel(line);
}

function getSaleCustomerName() {
  return String(selectedCustomer?.name || '').trim();
}

function getSaleCustomerPhone() {
  return String(selectedCustomer?.phone || '').trim();
}

function getSaleCustomerPan() {
  return String(document.getElementById('pos-customer-pan')?.value || '').trim();
}

function renderPosCustomerDisplay() {
  const box = document.getElementById('pos-customer-display');
  const nameEl = document.getElementById('pos-customer-display-name');
  const phoneEl = document.getElementById('pos-customer-display-phone');
  const emailEl = document.getElementById('pos-customer-display-email');
  const addressEl = document.getElementById('pos-customer-display-address');
  const name = getSaleCustomerName();
  const phone = getSaleCustomerPhone();
  const email = String(selectedCustomer?.email || '').trim();
  const address = String(selectedCustomer?.address || '').trim();
  if (!box) return;
  if (!name) {
    box.hidden = true;
    if (nameEl) nameEl.textContent = '';
    if (phoneEl) phoneEl.textContent = '—';
    if (emailEl) emailEl.textContent = '—';
    if (addressEl) addressEl.textContent = '—';
    return;
  }
  box.hidden = false;
  if (nameEl) nameEl.textContent = name;
  if (phoneEl) phoneEl.textContent = phone || '—';
  if (emailEl) emailEl.textContent = email || '—';
  if (addressEl) addressEl.textContent = address || '—';
}

function ensurePosCustomerName() {
  if (getSaleCustomerName()) return true;
  toast(t('customerNamePrompt'));
  return false;
}

function resetPosCustomer() {
  selectedCustomer = null;
  const search = document.getElementById('pos-customer-search');
  if (search) search.value = '';
  const pan = document.getElementById('pos-customer-pan');
  if (pan) pan.value = '';
  const box = document.getElementById('customer-suggestions');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderPosCustomerDisplay();
  renderSaleCustomer();
}

function applyPosCustomer(customer) {
  selectedCustomer = {
    name: String(customer?.name || '').trim(),
    phone: String(customer?.phone || '').trim(),
    email: String(customer?.email || '').trim(),
    address: String(customer?.address || '').trim()
  };
  const search = document.getElementById('pos-customer-search');
  const box = document.getElementById('customer-suggestions');
  if (search) search.value = '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderPosCustomerDisplay();
  renderSaleCustomer();
}

function getPosOldGoldCredit() {
  if (!posOldGold || !(Number(posOldGold.weightGrams) > 0) || !(Number(posOldGold.ratePerTola) > 0)) return 0;
  const tola = Number(posOldGold.weightGrams) / TOLA_GRAMS;
  return Math.round(tola * Number(posOldGold.ratePerTola) * ((Number(posOldGold.karat) || 24) / 24));
}

function getPosSchemeCredit() {
  if (!posSchemeId) return 0;
  const scheme = schemesCache.find((s) => s.id === posSchemeId);
  return scheme ? Number(scheme.paidTotal) || 0 : 0;
}

function getSaleTotals() {
  const subtotal = posCart.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = inputMoneyToNpr(document.getElementById('cart-discount')?.value);
  const afterDiscount = Math.max(0, subtotal - discount);
  const taxType = document.getElementById('cart-tax-type')?.value || 'percent';
  const taxValue = Number(document.getElementById('cart-tax-value')?.value) || 0;
  let taxAmount = 0;
  if (taxValue > 0) {
    taxAmount = taxType === 'percent'
      ? Math.round(afterDiscount * taxValue / 100)
      : Math.max(0, inputMoneyToNpr(taxValue));
  }
  // Optional 0.5% Skill Promotion Fee (सिप प्रवर्द्धन शुल्क) — mirrors the
  // server-side calculation exactly (Math.round(afterDiscount * 0.005)).
  // Nepal only: the fee does not exist for USA / Canada shops.
  const skillFeeEnabled = isNepalShop() && document.getElementById('pos-skill-fee')?.checked === true;
  const skillFeeAmount = skillFeeEnabled ? Math.round(afterDiscount * 0.005) : 0;
  const grossTotal = afterDiscount + taxAmount + skillFeeAmount;
  const oldGoldCredit = getPosOldGoldCredit();
  const schemeCredit = getPosSchemeCredit();
  const creditApplied = Math.min(grossTotal, oldGoldCredit + schemeCredit);
  const total = grossTotal - creditApplied;
  const taxLabel = taxType === 'percent' && taxValue > 0
    ? `${shopTaxName()} (${taxValue}%)`
    : shopTaxName();
  return { subtotal, discount, afterDiscount, taxType, taxValue, taxAmount, taxLabel, skillFeeEnabled, skillFeeAmount, oldGoldCredit, schemeCredit, creditApplied, total };
}

// Nudge the VAT/tax value up or down with the −/+ buttons. Nothing is applied by
// default — VAT stays optional and selectable. For a percentage, the first "+"
// from zero jumps to the shop's configured VAT rate (13% in Nepal), then each tap
// changes it by 1%. For a flat amount, each tap steps by 100.
function stepTax(dir) {
  const typeEl = document.getElementById('cart-tax-type');
  const valEl = document.getElementById('cart-tax-value');
  if (!typeEl || !valEl) return;
  const isPercent = typeEl.value === 'percent';
  let v = Number(valEl.value) || 0;
  if (isPercent) {
    const base = shopDefaultTaxRate();
    if (dir > 0 && v === 0 && base > 0) v = base;
    else v = v + dir;
    v = Math.min(100, Math.max(0, Math.round(v * 1000) / 1000));
  } else {
    v = Math.max(0, v + dir * 100);
  }
  valEl.value = v;
  updateTaxInputUi();
  renderCart();
}

function updateTaxInputUi() {
  const type = document.getElementById('cart-tax-type')?.value;
  const input = document.getElementById('cart-tax-value');
  if (!input) return;
  if (type === 'percent') {
    // USA/Canada rates are often fractional (8.875%), so allow finer steps there.
    input.step = shopCountryConfig().taxStep;
    input.max = '100';
  } else {
    input.removeAttribute('max');
    input.step = '100';
  }
}

// Clear the tax/discount boxes for the next sale. Nepal starts at 0 — VAT stays
// opt-in per bill, exactly as before. USA / Canada start pre-filled with the
// shop's configured sales-tax percentage, which staff can still edit or clear.
function resetSaleTaxAndDiscount() {
  const discount = document.getElementById('cart-discount');
  const taxValue = document.getElementById('cart-tax-value');
  const taxType = document.getElementById('cart-tax-type');
  if (discount) discount.value = 0;
  if (taxType) taxType.value = 'percent';
  if (taxValue) taxValue.value = isNepalShop() ? 0 : (Number(settingsCache.salesTaxRate) || 0);
  updateTaxInputUi();
}

const PAYMENT_METHOD_KEYS = {
  cash: 'payCash',
  esewa: 'payEsewa',
  khalti: 'payKhalti',
  card: 'payCard',
  bank: 'payBank',
  credit: 'payCredit'
};

function paymentMethodLabel(method) {
  return t(PAYMENT_METHOD_KEYS[method] || 'payCash');
}

// Resolve the payment for the current sale. Cash uses the amount-received field
// to compute change (defaulting to exact total when blank); non-cash electronic
// methods are treated as paid in full; "credit" supports a partial payment now
// (Paid now field) with the rest recorded as due — e.g. total 10,000, paid
// 3,000 → due 7,000. Both amounts are saved on the invoice.
function getSalePayment() {
  const method = document.getElementById('cart-payment-method')?.value || 'cash';
  const total = getSaleTotals().total;
  if (method === 'credit') {
    const raw = document.getElementById('cart-received')?.value;
    const received = Math.min(Math.max(0, raw ? inputMoneyToNpr(raw) : 0), total);
    return { method, received, change: 0, due: Math.max(0, total - received) };
  }
  if (method === 'cash') {
    const raw = document.getElementById('cart-received')?.value;
    const received = raw ? inputMoneyToNpr(raw) : total;
    return { method, received, change: Math.max(0, received - total), due: Math.max(0, total - received) };
  }
  return { method, received: total, change: 0, due: 0 };
}

function updatePaymentUi() {
  const method = document.getElementById('cart-payment-method')?.value || 'cash';
  const receivedRow = document.getElementById('cart-received-row');
  const changeRow = document.getElementById('cart-change-row');
  const changeLabel = document.getElementById('cart-change-label');
  const changeEl = document.getElementById('cart-change');
  if (!changeRow || !changeLabel || !changeEl) return;
  if (receivedRow) {
    receivedRow.hidden = method !== 'cash' && method !== 'credit';
    const receivedLabel = receivedRow.querySelector('span');
    if (receivedLabel) {
      receivedLabel.textContent = method === 'credit'
        ? (t('paidNowOptional') !== 'paidNowOptional' ? t('paidNowOptional') : 'Paid now (optional)')
        : t('amountReceived');
    }
  }

  // Payment reference input: cheque no. for bank/card, QR/transaction ref for
  // eSewa/Khalti — printed on the guarantee bill's payment line.
  const payrefRow = document.getElementById('cart-payref-row');
  const payrefLabel = document.getElementById('cart-payref-label');
  if (payrefRow && payrefLabel) {
    const wantsRef = ['bank', 'card', 'esewa', 'khalti'].includes(method);
    payrefRow.hidden = !wantsRef;
    if (wantsRef) payrefLabel.textContent = t(method === 'bank' || method === 'card' ? 'chequeNo' : 'qrRef');
  }

  const total = getSaleTotals().total;
  const setChange = (labelKey, amount, isShort) => {
    changeRow.hidden = false;
    changeLabel.textContent = t(labelKey);
    changeEl.textContent = formatMoney(amount);
    changeEl.classList.toggle('is-short', Boolean(isShort));
  };

  if (method === 'credit') {
    const raw = document.getElementById('cart-received')?.value;
    const received = Math.min(Math.max(0, inputMoneyToNpr(raw)), total);
    setChange('balanceDue', Math.max(0, total - received), true);
  } else if (method === 'cash') {
    const raw = document.getElementById('cart-received')?.value;
    const received = inputMoneyToNpr(raw);
    if (!raw || received <= 0) {
      changeRow.hidden = true;
    } else if (received >= total) {
      setChange('changeDue', received - total, false);
    } else {
      setChange('balanceDue', total - received, true);
    }
  } else {
    changeRow.hidden = true;
  }
}

function resetSalePayment() {
  const method = document.getElementById('cart-payment-method');
  const received = document.getElementById('cart-received');
  if (method) method.value = 'cash';
  if (received) received.value = '';
  const payref = document.getElementById('cart-payref');
  if (payref) payref.value = '';
  updatePaymentUi();
}

// Extra fields printed on the guarantee bill (ग्यारेन्टी बिल): buyer identity,
// order/delivery dates, goldsmith, old/add weight and the payment reference.
function getBillExtras() {
  const method = document.getElementById('cart-payment-method')?.value || 'cash';
  const payref = String(document.getElementById('cart-payref')?.value || '').trim();
  return {
    buyerIdNo: String(document.getElementById('pos-bill-idno')?.value || '').trim(),
    buyerAddress: String(selectedCustomer?.address || '').trim(),
    orderDate: String(document.getElementById('pos-bill-orderdate')?.value || '').trim(),
    deliveryDate: String(document.getElementById('pos-bill-deliverydate')?.value || '').trim(),
    kaligadh: String(document.getElementById('pos-bill-kaligadh')?.value || '').trim(),
    oldWeightGrams: Number(document.getElementById('pos-bill-oldweight')?.value) || 0,
    addWeightGrams: Number(document.getElementById('pos-bill-addweight')?.value) || 0,
    chequeNo: method === 'bank' || method === 'card' ? payref : '',
    qrRef: method === 'esewa' || method === 'khalti' ? payref : ''
  };
}

function resetBillExtras() {
  ['pos-bill-idno', 'pos-bill-orderdate', 'pos-bill-deliverydate', 'pos-bill-kaligadh', 'pos-bill-oldweight', 'pos-bill-addweight'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const skill = document.getElementById('pos-skill-fee');
  if (skill) skill.checked = false;
  const details = document.getElementById('pos-bill-details');
  if (details) details.open = false;
}

// Functional replacement for the old static "AI upselling" placeholder: show a
// few in-stock items the cashier is likely to add next — same category as the
// cart when possible, otherwise the cheapest available stock — as tap-to-add
// chips. Items already in the cart are skipped.
function renderQuickSuggestions() {
  const wrap = document.getElementById('quick-suggestions');
  const chips = document.getElementById('quick-suggestions-chips');
  if (!wrap || !chips) return;

  const inCart = new Set(posCart.map((l) => l.itemId));
  const available = posItemsCache.filter((i) => availableQuantity(i) > 0 && !inCart.has(i.id));

  const cartCategories = new Set(
    posCart.map((l) => l.category).filter(Boolean)
  );
  const scored = available.slice().sort((a, b) => {
    const aMatch = cartCategories.has(a.category) ? 0 : 1;
    const bMatch = cartCategories.has(b.category) ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return getItemDisplayPrice(a) - getItemDisplayPrice(b);
  });

  const picks = scored.slice(0, 4);
  if (!picks.length) {
    wrap.hidden = true;
    chips.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  chips.innerHTML = picks.map((item) => `
    <button type="button" class="quick-chip" data-quick-add="${escapeHtml(item.id)}" title="${escapeHtml(categoryLabel(item.category || 'gold'))} · ${formatMoney(getItemDisplayPrice(item))}">
      <span class="quick-chip-name">${escapeHtml(item.name)}</span>
      <span class="quick-chip-price">${formatMoney(getItemDisplayPrice(item))}</span>
    </button>`).join('');
}

function renderSaleCustomer() {
  const el = document.getElementById('sale-customer');
  if (!el) return;
  const name = getSaleCustomerName();
  const phone = getSaleCustomerPhone();
  if (!name) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<span class="sale-customer-label">${t('customer')}</span><strong>${escapeHtml(name)}</strong>${phone ? `<span class="sale-customer-phone">${escapeHtml(phone)}</span>` : ''}`;
}

function renderCart() {
  const linesEl = document.getElementById('cart-lines');
  if (!linesEl) return;

  if (!posCart.length) {
    linesEl.innerHTML = `<p class="cart-empty">${t('cartEmpty')}</p>`;
  } else {
    linesEl.innerHTML = posCart.map((line, idx) => {
      const meta = line.custom
        ? `${lineMetalLabel(line)} · ${line.sku} · ${line.karat || '—'}K · ${line.weightGrams || '—'}g × ${line.qty}`
        : `${lineMetalLabel(line)} · ${line.sku || '—'} × ${line.qty}`;
      const max = maxCartQty(line);
      const atMax = Number.isFinite(max) && line.qty >= max;
      return `
      <div class="cart-line">
        <div class="cart-line-info">
          <strong class="cart-line-name">${escapeHtml(cartLineName(line))}</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        <div class="cart-line-actions">
          <div class="cart-qty" role="group" aria-label="${t('quantity')}">
            <button type="button" class="cart-qty-btn" data-cart-dec="${idx}" aria-label="−">−</button>
            <input type="number" class="cart-qty-input" min="1" step="1" value="${escapeHtml(line.qty)}" data-cart-qty="${idx}" aria-label="${t('quantity')}" />
            <button type="button" class="cart-qty-btn" data-cart-inc="${idx}" aria-label="+"${atMax ? ' disabled' : ''}>+</button>
          </div>
          <span class="cart-line-total">${formatMoney(line.price * line.qty)}</span>
          <button type="button" class="cart-remove" data-cart-remove="${idx}" title="${t('delete')}" aria-label="${t('delete')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  const totals = getSaleTotals();
  document.getElementById('cart-subtotal').textContent = `${formatMoney(totals.subtotal)}`;
  document.getElementById('cart-total').textContent = `${formatMoney(totals.total)}`;

  const taxRow = document.getElementById('cart-tax-applied-row');
  const taxLabelEl = document.getElementById('cart-tax-applied-label');
  const taxAmountEl = document.getElementById('cart-tax-applied');
  if (taxRow && taxLabelEl && taxAmountEl) {
    if (totals.taxAmount > 0) {
      taxRow.hidden = false;
      taxLabelEl.textContent = totals.taxLabel;
      taxAmountEl.textContent = `${formatMoney(totals.taxAmount)}`;
    } else {
      taxRow.hidden = true;
    }
  }

  const skillFeeEl = document.getElementById('cart-skillfee');
  if (skillFeeEl) skillFeeEl.textContent = totals.skillFeeAmount > 0 ? `${formatMoney(totals.skillFeeAmount)}` : '—';

  const ogRow = document.getElementById('cart-oldgold-row');
  const ogCreditEl = document.getElementById('cart-oldgold-credit');
  if (ogRow && ogCreditEl) {
    ogRow.hidden = !(totals.oldGoldCredit > 0);
    if (totals.oldGoldCredit > 0) ogCreditEl.textContent = `- ${formatMoney(totals.oldGoldCredit)}`;
  }
  const schRow = document.getElementById('cart-scheme-row');
  const schCreditEl = document.getElementById('cart-scheme-credit');
  if (schRow && schCreditEl) {
    schRow.hidden = !(totals.schemeCredit > 0);
    if (totals.schemeCredit > 0) schCreditEl.textContent = `- ${formatMoney(totals.schemeCredit)}`;
  }

  renderSaleCustomer();
  updatePaymentUi();
  renderQuickSuggestions();
  refreshStockDisplays();
}

function refreshStockDisplays() {
  renderPosCatalog();
  renderInventoryTable();
}

function renderPosCatalog() {
  const grid = document.getElementById('pos-product-grid');
  if (!grid) return;

  const sort = document.getElementById('pos-sort')?.value || 'name';
  let visible = [...posItemsCache].filter((item) => Number(item.quantity) > 0);
  if (sort === 'price') {
    visible.sort((a, b) => getItemDisplayPrice(a) - getItemDisplayPrice(b));
  } else {
    visible.sort((a, b) => a.name.localeCompare(b.name));
  }

  const inStock = visible.filter((item) => availableQuantity(item) > 0);
  const countEl = document.getElementById('pos-item-count');
  if (countEl) {
    countEl.textContent = inStock.length
      ? t('posItemCountFmt').replace('{n}', inStock.length)
      : '';
  }

  if (!inStock.length) {
    grid.classList.remove('has-products');
    grid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>
      <p>${t('noProducts')}</p>
    </div>`;
    return;
  }

  grid.classList.add('has-products');
  grid.innerHTML = `
    <div class="table-wrap pos-catalog-table-wrap">
      <table class="data-table pos-item-list">
        <thead>
          <tr>
            <th>${t('name')}</th>
            <th>${t('sku')}</th>
            <th>${t('itemMetal')}</th>
            <th>${t('stock')}</th>
            <th>${t('status')}</th>
            <th>${t('priceInfo')}</th>
            <th class="pos-list-action-col"></th>
          </tr>
        </thead>
        <tbody>
          ${inStock.map((item) => {
            const qty = availableQuantity(item);
            const displayItem = itemStockStatusForDisplay(item);
            return `
            <tr class="pos-item-row">
              <td class="pos-item-name-cell">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="pos-item-meta">${escapeHtml(item.karat)}K · ${escapeHtml(item.weightGrams)}g${item.location ? ` · ${escapeHtml(item.location)}` : ''}</span>
              </td>
              <td>${escapeHtml(item.sku)}</td>
              <td>${escapeHtml(categoryLabel(item.category))}</td>
              <td><span class="product-stock product-stock-inline">${qty}</span></td>
              <td>${itemStockStatusBadge(displayItem)}</td>
              <td class="pos-item-price">${formatMoney(getItemDisplayPrice(item))}</td>
              <td class="pos-list-action-col">
                <button type="button" class="product-cart-btn" data-pos-add-cart="${escapeHtml(item.id)}" title="${t('addToCart')}" aria-label="${t('addToCart')}">${cartIcon()}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  renderQuickSuggestions();
}

function renderInventoryTable() {
  const tableEl = document.getElementById('inventory-table');
  if (!tableEl) return;

  if (!itemsCache.length) {
    tableEl.innerHTML = `<table class="data-table">${inventoryTableHead()}<tbody><tr class="empty-row"><td colspan="9">${t('noResults')}</td></tr></tbody></table>`;
    return;
  }

  const goldRatePerTola = goldRateCache;
  tableEl.innerHTML = `<table class="data-table">${inventoryTableHead()}<tbody>
    ${itemsCache.map((i) => {
      const qty = availableQuantity(i);
      const tola = (i.weightGrams / 11.664).toFixed(3);
      const making = i.makingCharge || 0;
      const metalSlug = String(i.category || 'gold').toLowerCase();
      const ratePerTola = metalSlug === 'silver'
        ? (Number(silverRateCache) || 0)
        : (metalSlug === 'other' ? (Number(i.customRatePerTola) || 0) : (Number(goldRatePerTola) || 0));
      const kf = metalSlug === 'silver' || metalSlug === 'other' ? 1 : ((Number(i.karat) || 24) / 24);
      const metalValue = ((Number(i.weightGrams) || 0) / 11.664) * ratePerTola * kf;
      const jartiAmt = calcJartiAmount({
        jartiRateType: i.jartiRateType, jartiRateValue: i.jartiRateValue,
        weightGrams: i.weightGrams, metalValue, ratePerTola, karatFactor: kf
      });
      const amount = Math.round(metalValue + jartiAmt);
      const stone = Number(i.stoneAmount) || 0;
      return `<tr${qty <= 0 ? ' style="opacity:.55"' : ''}>
        <td class="name-cell">
          <strong>${escapeHtml(i.name)}</strong>
          <div style="font-size:.72rem;margin-top:.15rem">
            ${i.itemNumber ? `<span style="font-weight:700;padding:.1rem .4rem;border-radius:4px;background:rgba(184,134,11,.13);color:#b8860b">${escapeHtml(i.itemNumber)}</span> ` : ''}
            <span style="opacity:.5">${escapeHtml(i.sku)}${qty <= 0 ? ' · <span style="color:#b91c1c;font-weight:700">SOLD OUT</span>' : ` · x${qty}`}</span>
          </div>
        </td>
        <td><span style="font-size:.78rem;font-weight:700;padding:.15rem .45rem;border-radius:4px;background:rgba(184,134,11,.13);color:#b8860b">${escapeHtml(i.karat)}K</span></td>
        <td>
          ${i.weightUnit === 'tola'
    ? (() => { const p = gramsToTolaParts(Number(i.weightGrams) || 0); return `<div style="font-size:.85rem;font-weight:500">${Number(p.tola) || 0} tola ${formatWeightQty(Number(p.laal) || 0, 2)} laal</div>`; })()
    : `<div style="font-size:.85rem;font-weight:500">${escapeHtml(i.weightGrams)}g</div>`}
        </td>
        <td style="font-size:.82rem">${ratePerTola > 0 ? (i.weightUnit === 'tola'
          ? `<div style="font-weight:600">${formatMoney(ratePerTola)} <span style="font-size:.68rem;font-weight:400;opacity:.5">/tola</span></div>`
          : `<div style="font-weight:600">${formatMoney(Math.round(ratePerTola / 11.664))} <span style="font-size:.68rem;font-weight:400;opacity:.5">/gram</span></div>`) : '<span style="opacity:.35">—</span>'}</td>
        <td style="font-size:.82rem;font-weight:600">${amount > 0 ? formatMoney(amount) : '<span style="opacity:.35">—</span>'}</td>
        <td style="font-size:.82rem">${making > 0 ? formatMoney(making) : '<span style="opacity:.35">—</span>'}</td>
        <td style="font-size:.82rem">${stone > 0 ? formatMoney(stone) : '<span style="opacity:.35">—</span>'}</td>
        <td style="font-weight:700">${formatMoney(getItemDisplayPrice(i))}</td>
        <td class="options-cell inventory-actions-cell">
          <button type="button" class="link-btn" data-qr="${escapeHtml(i.id)}">QR</button>
          <button type="button" class="link-btn" data-print-tag="${escapeHtml(i.id)}">🏷️ Tag</button>
          ${isItemSoldOut(i)
    ? '<span class="inventory-no-edit">—</span>'
    : `<button type="button" class="link-btn" data-edit="${escapeHtml(i.id)}">${t('edit')}</button>`}
          <button type="button" class="link-btn danger" data-delete="${escapeHtml(i.id)}">${t('delete')}</button>
        </td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

function customItemPriceFromFields(form) {
  return itemPriceFromForm(form, '');
}

function updateItemPricePreview() {
  const form = document.getElementById('item-form');
  const preview = document.getElementById('item-price-preview');
  const breakdownEl = document.getElementById('item-price-breakdown');
  if (!form || !preview) return;
  const calculated = itemPriceFromForm(form, '');
  preview.value = calculated != null ? formatMoney(calculated) : '—';
  const salePriceInput = form.salePrice;
  if (salePriceInput && !salePriceInput.value && calculated != null) {
    salePriceInput.placeholder = formatMoneyPlain(calculated);
  }
  if (breakdownEl) {
    const weightGrams = getWeightGramsFromForm(form, '');
    const weightUnit = getWeightUnit(form, '');
    const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, '') : null;
    const makingCharge = parseMoneyField(form.makingCharge?.value) || 0;
    const html = renderOrderPriceBreakdown({
      weightUnit,
      weightGrams,
      tolaParts,
      makingChargeNpr: makingCharge,
      qty: 1
    });
    breakdownEl.innerHTML = html;
    breakdownEl.hidden = !html;
  }
}

function updateCustomItemPricePreview() {
  const form = document.getElementById('custom-item-form');
  const preview = document.getElementById('custom-item-price-preview');
  if (!form || !preview) return;
  const calculated = customItemPriceFromFields(form);
  preview.value = calculated != null ? formatMoney(calculated) : '—';
  const salePriceInput = form.salePrice;
  if (salePriceInput && !salePriceInput.value && calculated != null) {
    salePriceInput.placeholder = formatMoneyPlain(calculated);
  }
}

function renderCustomItemCustomerSuggestions() {
  const input = document.getElementById('custom-item-customer-search');
  const box = document.getElementById('custom-item-customer-suggestions');
  const form = document.getElementById('custom-item-form');
  if (!input || !box || !form) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const matches = customersCache.filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    form.customerName.value = input.value.trim();
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-custom-item-customer-pick="${escapeHtml(c.id)}">
      ${escapeHtml(c.name)}
      <span class="suggestion-meta">${escapeHtml(c.phone || c.email || '')}</span>
    </button>`).join('');
}

function fillCustomItemCustomerFields(customer) {
  const form = document.getElementById('custom-item-form');
  const search = document.getElementById('custom-item-customer-search');
  const box = document.getElementById('custom-item-customer-suggestions');
  if (!form) return;
  form.customerName.value = customer.name || '';
  form.customerPhone.value = customer.phone || '';
  if (search) search.value = customer.name || '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function openCustomItemModal() {
  openOrderModal({ context: 'pos' }).catch(() => {});
}

function addCustomItemToCart(data) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  const itemName = String(data.name || '').trim();
  const qty = Math.max(1, Number(data.quantity) || 1);
  const weightUnit = data.weightUnit || 'grams';
  const tolaParts = data.tolaParts || null;
  const calculated = calcItemLinePrice({
    category: data.category || 'gold',
    karat: Number(data.karat) || 24,
    weightGrams: Number(data.weightGrams),
    makingCharge: parseMoneyField(data.makingCharge) || 0,
    customRatePerTola: parseMoneyField(data.customRatePerTola) || 0,
    salePrice: data.salePrice != null ? parseMoneyField(data.salePrice) : 0,
    jartiRateType: data.jartiRateType || 'flat',
    jartiRateValue: Number(data.jartiRateValue) || 0
  }, { weightUnit, tolaParts });
  const manualPrice = data.salePrice !== '' && data.salePrice != null
    ? parseMoneyField(data.salePrice)
    : null;
  const unitPrice = manualPrice != null && Number.isFinite(manualPrice) && manualPrice >= 0
    ? manualPrice
    : calculated;

  if (!itemName) {
    toast(t('customItemNameRequired'));
    return;
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    toast(t('customItemPriceRequired'));
    return;
  }

  const customerName = String(data.customerName || '').trim();
  const customerPhone = String(data.customerPhone || '').trim();
  if (customerName) {
    applyPosCustomer({ name: customerName, phone: customerPhone });
  }

  const sku = generateSku('CUSTOM');
  const karat = Number(data.karat) || 24;
  const weightGrams = Number(data.weightGrams) || 0;

  posCart.push({
    itemId: `custom-${Date.now()}`,
    custom: true,
    sku,
    name: itemName,
    category: data.category || 'gold',
    karat,
    customRatePerTola: parseMoneyField(data.customRatePerTola) || 0,
    weightGrams,
    location: String(data.location || '').trim(),
    notes: String(data.notes || '').trim(),
    hsCode: String(data.hsCode || '').trim(),
    stoneAmount: parseMoneyField(data.stoneAmount) || 0,
    makingCharge: parseMoneyField(data.makingCharge) || 0,
    jartiRateType: data.jartiRateType || 'flat',
    jartiRateValue: Number(data.jartiRateValue) || 0,
    qty,
    price: unitPrice
  });
  renderCart();
  toast(t('customItemAdded'));
}

function addToCart(item) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  if (!ensurePosCustomerName()) return;
  if (!canAddItemToPosCart(item)) {
    toast(t('noStock'));
    return;
  }
  const existing = posCart.find((l) => l.itemId === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    posCart.push({
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category || 'gold',
      qty: 1,
      price: getItemDisplayPrice(item)
    });
  }
  renderCart();
}

function addOrderToCart(order) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  if (!order?.lines?.length) {
    toast(t('noItemsInOrder'));
    return;
  }

  order.lines.forEach((line, index) => {
    const item = getItemFromCaches(line.itemId);
    const qty = Math.max(1, Number(line.quantity) || 1);
    const price = Number(line.unitPrice)
      || (item ? getItemDisplayPrice(item) : 0);
    const cartKey = `order-${order.id}-${line.itemId || index}`;
    const existing = posCart.find((l) => l.cartKey === cartKey);

    if (existing) {
      existing.qty += qty;
      if (price) existing.price = price;
      if (!existing.name) existing.name = line.itemName || item?.name || existing.sku;
      return;
    }

    posCart.push({
      cartKey,
      itemId: cartKey,
      fromOrder: order.id,
      orderNumber: order.orderNumber,
      custom: true,
      sku: line.sku || item?.sku || '—',
      name: line.itemName || item?.name || t('item'),
      qty,
      price
    });
  });

  if (order.customerName) {
    applyPosCustomer({
      name: order.customerName,
      phone: order.customerPhone || ''
    });
  }

  renderCart();
  showView('pos');
  toast(t('orderAddedToCart'));
}

function renderCustomerSuggestions() {
  const input = document.getElementById('pos-customer-search');
  const box = document.getElementById('customer-suggestions');
  if (!input || !box) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const matches = customersCache.filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-customer-pick="${escapeHtml(c.id)}">
      ${escapeHtml(c.name)}
      <span class="suggestion-meta">${escapeHtml(c.phone || c.email || '')}</span>
    </button>`).join('');
}

function selectPosCustomer(customer) {
  applyPosCustomer(customer);
}

function isNonInventoryCartLine(line) {
  return Boolean(line?.custom || line?.fromOrder);
}

function cartQtyForItem(itemId) {
  if (!itemId) return 0;
  const id = String(itemId);
  if (id.startsWith('custom-') || id.startsWith('order-')) return 0;
  return posCart
    .filter((line) => line.itemId === itemId && !isNonInventoryCartLine(line))
    .reduce((sum, line) => sum + line.qty, 0);
}

function getItemFromCaches(itemId) {
  return itemsCache.find((i) => i.id === itemId)
    || orderItemsCache.find((i) => i.id === itemId)
    || posItemsCache.find((i) => i.id === itemId);
}

// Maximum quantity a cart line may reach. Inventory lines are capped by total
// stock on hand; custom / order lines have no stock limit.
function maxCartQty(line) {
  if (!line || isNonInventoryCartLine(line)) return Infinity;
  const item = getItemFromCaches(line.itemId);
  const stock = Number(item?.quantity);
  return Number.isFinite(stock) && stock > 0 ? stock : line.qty;
}

// Set a cart line to an explicit quantity, clamped to [1, stock]. Returns true
// if the value was clamped below the requested amount (i.e. hit stock limit).
function setCartQty(idx, qty) {
  const line = posCart[idx];
  if (!line) return false;
  const requested = Math.max(1, Math.floor(Number(qty) || 1));
  const max = maxCartQty(line);
  const clamped = Number.isFinite(max) ? Math.min(requested, max) : requested;
  line.qty = clamped;
  renderCart();
  return clamped < requested;
}

function availableQuantity(itemOrId) {
  const item = typeof itemOrId === 'string' ? getItemFromCaches(itemOrId) : itemOrId;
  if (!item) return 0;
  return Math.max(0, Number(item.quantity) - cartQtyForItem(item.id));
}

function mergeItemsIntoCache(items) {
  items.forEach((item) => {
    const idx = itemsCache.findIndex((i) => i.id === item.id);
    if (idx >= 0) itemsCache[idx] = { ...itemsCache[idx], ...item };
    else itemsCache.push(item);
  });
}

function canAddItemToPosCart(item) {
  return availableQuantity(item) > 0;
}

function isItemSoldOut(item) {
  return Boolean(item && (item.status === 'sold_out' || Number(item.quantity) <= 0));
}

function itemStockStatusForDisplay(item) {
  return { ...item, quantity: availableQuantity(item) };
}

// Barcode / quick-add: pressing Enter in the product search adds the item when
// there is an exact SKU match, or when the current filter leaves exactly one
// in-stock item. Lets a barcode scanner (which types the code then Enter) add
// straight to the cart without a mouse.
async function quickAddFromSearch() {
  const input = document.getElementById('pos-search');
  const term = (input?.value || '').trim();
  if (!term) return;
  await loadPOS();
  const lower = term.toLowerCase();
  let match = posItemsCache.find(
    (i) => (String(i.sku || '').toLowerCase() === lower
      || String(i.itemNumber || '').toLowerCase() === lower) && availableQuantity(i) > 0
  );
  if (!match) {
    const inStock = posItemsCache.filter((i) => availableQuantity(i) > 0);
    if (inStock.length === 1) match = inStock[0];
  }
  if (!match) {
    toast(t('posNoMatch'));
    return;
  }
  addToCart(match);
  if (input) input.value = '';
  await loadPOS();
}

async function loadPOS() {
  const q = document.getElementById('pos-search')?.value.trim() || '';
  const category = document.getElementById('pos-filter-category')?.value || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);

  const payload = await api(`/api/items?${params}`);
  applyMetalRatesFromResponse(payload);
  const { items } = payload;
  mergeItemsIntoCache(items);
  posItemsCache = items.filter((item) => Number(item.quantity) > 0);

  renderPosCatalog();
}

function reportDateRange() {
  const start = document.getElementById('report-start')?.value || '';
  const end = document.getElementById('report-end')?.value || '';
  return { start, end };
}

function expensesInRange(start, end) {
  return localData('subarnapasal.expenses', []).filter((e) => {
    if (start && e.date < start) return false;
    if (end && e.date > end) return false;
    return true;
  });
}

function renderBarChart(rows, emptyText) {
  if (!rows.length) return `<p class="empty">${emptyText}</p>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="category-chart">${rows.map((row) => {
    const pct = Math.round((row.value / max) * 100);
    return `<div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span>${escapeHtml(row.display ?? row.value)}</span></div>`;
  }).join('')}</div>`;
}

function renderReportTable(headers, rows, emptyText) {
  if (!rows.length) return `<p class="empty">${emptyText}</p>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
    ${headers.map((h) => `<th>${h}</th>`).join('')}
  </tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function updateReportSectionTitle() {
  const titleEl = document.getElementById('report-section-title');
  if (!titleEl) return;
  const key = reportTab === 'inventory'
    ? 'inventoryOverview'
    : reportTab === 'customer'
      ? 'customerOverview'
      : reportTab === 'invoices'
        ? 'invoicesOverview'
        : 'salesOverview';
  titleEl.textContent = t(key);
}

function buildMonthlySalesData(salesByDay) {
  const map = {};
  for (const { date, amount } of (salesByDay || [])) {
    const key = String(date).slice(0, 7);
    map[key] = (map[key] || 0) + Number(amount);
  }
  const now = new Date();
  const result = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    result.push({
      key,
      label: d.toLocaleString('default', { month: 'short' }),
      fullLabel: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
      value: map[key] || 0
    });
  }
  return result;
}

function buildWeeklySalesData(salesByDay) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayNum = today.getDay();
  const daysToMon = dayNum === 0 ? 6 : dayNum - 1;
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - daysToMon);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const thisWeek = [0, 0, 0, 0, 0, 0, 0];
  const lastWeek = [0, 0, 0, 0, 0, 0, 0];
  for (const { date, amount } of (salesByDay || [])) {
    const d = new Date(String(date) + 'T00:00:00');
    const diffThis = Math.round((d - thisMonday) / 86400000);
    if (diffThis >= 0 && diffThis < 7) thisWeek[diffThis] += Number(amount);
    const diffLast = Math.round((d - lastMonday) / 86400000);
    if (diffLast >= 0 && diffLast < 7) lastWeek[diffLast] += Number(amount);
  }
  return { dayLabels, thisWeek, lastWeek };
}

function renderSvgMonthlyBars(data) {
  const hasData = data.some(m => m.value > 0);
  if (!hasData) return `<p class="empty" style="padding:2rem;text-align:center;opacity:.5">No monthly sales data — record some sales to see your trend</p>`;
  const W = 500, H = 190, pL = 52, pB = 32, pT = 14, pR = 10;
  const cW = W - pL - pR, cH = H - pT - pB;
  const max = Math.max(...data.map(m => m.value), 1);
  const slotW = cW / data.length;
  const barW = Math.min(42, slotW - 8);
  const fmt = v => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const y = pT + cH * (1 - f);
    grid += `<line x1="${pL}" y1="${y.toFixed(0)}" x2="${W - pR}" y2="${y.toFixed(0)}" stroke="currentColor" stroke-opacity="0.07"/>`;
    if (i > 0) grid += `<text x="${pL - 4}" y="${(y + 3).toFixed(0)}" text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.45">${fmt(Math.round(max * f))}</text>`;
  }
  const bars = data.map((m, i) => {
    const isLast = i === data.length - 1;
    const x = pL + i * slotW + (slotW - barW) / 2;
    const bH = Math.max(m.value > 0 ? 3 : 0, (m.value / max) * cH);
    const y = pT + cH - bH;
    const op = isLast ? 0.92 : 0.3 + (i / data.length) * 0.45;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bH.toFixed(1)}" fill="#b8860b" fill-opacity="${op}" rx="3"><title>${m.fullLabel}: ${formatMoney(m.value)}</title></rect>
    ${m.value > 0 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="8" fill="currentColor" fill-opacity="0.6">${fmt(m.value)}</text>` : ''}
    <text x="${(x + barW / 2).toFixed(1)}" y="${(pT + cH + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="${isLast ? 1 : 0.6}" font-weight="${isLast ? 600 : 400}">${m.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:${H}px;display:block">${grid}${bars}
    <line x1="${pL}" y1="${pT + cH}" x2="${W - pR}" y2="${pT + cH}" stroke="currentColor" stroke-opacity="0.15"/>
  </svg>`;
}

function renderSvgWeeklyComparison(data) {
  const { dayLabels, thisWeek, lastWeek } = data;
  const W = 460, H = 145, pL = 42, pB = 26, pT = 10, pR = 8;
  const cW = W - pL - pR, cH = H - pT - pB;
  const max = Math.max(...thisWeek, ...lastWeek, 1);
  const slotW = cW / 7;
  const pairW = Math.min(30, slotW - 6);
  const bW = (pairW / 2) - 1;
  const fmt = v => v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);
  let grid = '';
  [0, 0.5, 1].forEach(f => {
    const y = pT + cH * (1 - f);
    grid += `<line x1="${pL}" y1="${y.toFixed(0)}" x2="${W - pR}" y2="${y.toFixed(0)}" stroke="currentColor" stroke-opacity="0.07"/>`;
    if (f > 0) grid += `<text x="${pL - 3}" y="${(y + 3).toFixed(0)}" text-anchor="end" font-size="8" fill="currentColor" fill-opacity="0.45">${fmt(Math.round(max * f))}</text>`;
  });
  const bars = dayLabels.map((lbl, i) => {
    const cx = pL + i * slotW + (slotW - pairW) / 2;
    const h1 = Math.max(0, (thisWeek[i] / max) * cH);
    const h2 = Math.max(0, (lastWeek[i] / max) * cH);
    return `<rect x="${cx.toFixed(1)}" y="${(pT + cH - h1).toFixed(1)}" width="${bW.toFixed(1)}" height="${h1.toFixed(1)}" fill="#b8860b" fill-opacity="0.88" rx="2"><title>This week ${lbl}: ${formatMoney(thisWeek[i])}</title></rect>
    <rect x="${(cx + bW + 2).toFixed(1)}" y="${(pT + cH - h2).toFixed(1)}" width="${bW.toFixed(1)}" height="${h2.toFixed(1)}" fill="#6b7280" fill-opacity="0.38" rx="2"><title>Last week ${lbl}: ${formatMoney(lastWeek[i])}</title></rect>
    <text x="${(cx + pairW / 2).toFixed(1)}" y="${(pT + cH + 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.65">${lbl}</text>`;
  }).join('');
  const thisTot = thisWeek.reduce((a, b) => a + b, 0);
  const lastTot = lastWeek.reduce((a, b) => a + b, 0);
  const diff = thisTot - lastTot;
  const pct = lastTot > 0 ? Math.round((diff / lastTot) * 100) : (thisTot > 0 ? 100 : 0);
  const indicator = (thisTot > 0 || lastTot > 0)
    ? `<span style="font-size:.78rem;font-weight:700;color:${diff >= 0 ? '#059669' : '#dc2626'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last week</span>`
    : '';
  return {
    svg: `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-height:${H}px;display:block">${grid}${bars}<line x1="${pL}" y1="${pT + cH}" x2="${W - pR}" y2="${pT + cH}" stroke="currentColor" stroke-opacity="0.15"/></svg>`,
    indicator, thisTot, lastTot, diff, pct
  };
}

function renderSalesReport(report, expenseTotal, netProfit) {
  const profitColor = netProfit >= 0 ? '#059669' : '#dc2626';
  const avgOrder = report.sales.completedOrders > 0
    ? Math.round(report.sales.orderRevenue / report.sales.completedOrders) : 0;

  document.getElementById('stats-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">${t('totalRevenue')}</span>
      <strong>${formatMoney(report.sales.revenue)}</strong>
      <span class="kpi-sub">${t('totalRevenueSub')}</span>
    </div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">${t('totalOrdersKpi')}</span>
      <strong>${report.sales.totalOrders}</strong>
      <span class="kpi-sub">${report.sales.completedOrders} completed · ${report.sales.pendingOrders} pending</span>
    </div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">Avg. Order Value</span>
      <strong>${formatMoney(avgOrder)}</strong>
      <span class="kpi-sub">Per completed order</span>
    </div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">${t('totalExpensesKpi')}</span>
      <strong>${formatMoney(expenseTotal)}</strong>
      <span class="kpi-sub">${t('totalExpensesSub')}</span>
    </div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">${t('netProfit')}</span>
      <strong style="color:${profitColor}">${formatMoney(netProfit)}</strong>
      <span class="kpi-sub">${netProfit >= 0 ? '✓ Profitable' : '↓ Review expenses'}</span>
    </div></div></div>
    ${report.receivedTotal != null ? (() => {
      const receivedTotal = Number(report.receivedTotal) || 0;
      const cashProfit = receivedTotal - expenseTotal;
      const cashColor = cashProfit >= 0 ? '#059669' : '#dc2626';
      return `
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">Payments Received</span>
      <strong>${formatMoney(receivedTotal)}</strong>
      <span class="kpi-sub">Cash actually collected (incl. credit receipts)</span>
    </div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">Profit</span>
      <strong style="color:${cashColor}">${formatMoney(cashProfit)}</strong>
      <span class="kpi-sub">Received payments − expenses</span>
    </div></div></div>`;
    })() : ''}`;

  const monthly = buildMonthlySalesData(report.sales.salesByDay);
  const weekly = buildWeeklySalesData(report.sales.salesByDay);
  const monthlyChart = renderSvgMonthlyBars(monthly);
  const { svg: weekSvg, indicator: weekIndicator, thisTot, lastTot } = renderSvgWeeklyComparison(weekly);

  const salesRows = report.sales.transactions.slice(0, 25).map((tx) => `<tr>
    <td style="font-size:.82rem">${new Date(tx.createdAt).toLocaleDateString()}</td>
    <td style="font-weight:500">${escapeHtml(tx.itemName)}</td>
    <td style="text-align:center">${escapeHtml(tx.quantity)}</td>
    <td style="text-align:right;font-weight:700">${formatMoney(tx.amount)}</td>
    <td style="opacity:.65;font-size:.82rem">${escapeHtml(tx.note || '—')}</td>
  </tr>`);

  document.getElementById('report-body').innerHTML = `
    <div class="panel-grid">
      <article class="panel">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem">
          <h2 style="margin:0">Monthly Revenue</h2>
          <span style="font-size:.78rem;opacity:.5">Last 6 months — hover bars for details</span>
        </div>
        <div style="display:flex;gap:1rem;margin-bottom:.5rem;font-size:.78rem;opacity:.6">
          <span><span style="display:inline-block;width:10px;height:10px;background:#b8860b;opacity:.9;border-radius:2px;margin-right:4px"></span>Current</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#b8860b;opacity:.4;border-radius:2px;margin-right:4px"></span>Previous</span>
        </div>
        ${monthlyChart}
      </article>
      <article class="panel">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem">
          <h2 style="margin:0">This Week vs Last Week</h2>
          ${weekIndicator}
        </div>
        <div style="display:flex;gap:1rem;margin-bottom:.5rem;font-size:.78rem;opacity:.6">
          <span><span style="display:inline-block;width:10px;height:10px;background:#b8860b;opacity:.88;border-radius:2px;margin-right:4px"></span>This week</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#6b7280;opacity:.38;border-radius:2px;margin-right:4px"></span>Last week</span>
        </div>
        ${weekSvg}
        <div style="display:flex;justify-content:space-around;margin-top:.75rem;text-align:center">
          <div><div style="font-weight:700;font-size:.95rem">${formatMoney(thisTot)}</div><div style="font-size:.72rem;opacity:.55;margin-top:.1rem">This Week</div></div>
          <div style="border-left:1px solid currentColor;opacity:.1"></div>
          <div><div style="font-weight:700;font-size:.95rem">${formatMoney(lastTot)}</div><div style="font-size:.72rem;opacity:.55;margin-top:.1rem">Last Week</div></div>
          <div style="border-left:1px solid currentColor;opacity:.1"></div>
          <div><div style="font-weight:700;font-size:.95rem">${formatMoney(report.sales.orderRevenue)}</div><div style="font-size:.72rem;opacity:.55;margin-top:.1rem">Order Revenue</div></div>
        </div>
      </article>
    </div>
    <article class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
        <h2 style="margin:0">${t('recentSales')}</h2>
        <div style="font-size:.8rem;opacity:.55">${report.sales.transactions.length} transactions</div>
      </div>
      ${renderReportTable([t('date'), t('item'), t('qty'), t('amount'), t('note')], salesRows, t('noSalesInPeriod'))}
    </article>`;
}

function renderInventoryReport(report) {
  const inv = report.inventory;
  document.getElementById('stats-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalPieces')}</span><strong>${inv.totalItems}</strong><span class="kpi-sub">${t('inStock')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('uniqueSkus')}</span><strong>${inv.uniqueSkus}</strong><span class="kpi-sub">${t('uniqueSkus')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalWeight')}</span><strong>${inv.totalWeightGrams}g</strong><span class="kpi-sub">${inv.totalWeightTola} ${t('perTola')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('inventoryValue')}</span><strong>${formatMoney(inv.totalInventoryValue)}</strong><span class="kpi-sub">${t('atCurrentGoldRate')}</span></div></div></div>`;

  const categoryChart = renderBarChart(
    Object.entries(inv.categoryCounts).map(([cat, count]) => ({
      label: categoryLabel(cat),
      value: count
    })),
    t('noStock')
  );

  const lowStock = inv.lowStock.length
    ? inv.lowStock.map((i) => `<li><strong>${escapeHtml(i.name)}</strong> — ${escapeHtml(i.quantity)} ${t('left')} (${escapeHtml(i.sku)})</li>`).join('')
    : `<li class="empty">${t('allWellStocked')}</li>`;

  const movementRows = inv.movements.map((tx) => `<tr>
    <td>${new Date(tx.createdAt).toLocaleDateString()}</td>
    <td>${txTypeLabel(tx.type)}</td>
    <td>${escapeHtml(tx.itemName)}</td>
    <td>${escapeHtml(tx.quantity)}</td>
    <td>${tx.type === 'sale' ? `${formatMoney(tx.amount)}` : '—'}</td>
    <td>${escapeHtml(tx.note || '—')}</td>
  </tr>`);

  document.getElementById('report-body').innerHTML = `
    <div class="panel-grid">
      <article class="panel"><h2>${t('stockByCategory')}</h2>${categoryChart}</article>
      <article class="panel"><h2>${t('lowStockAlerts')}</h2><ul class="simple-list">${lowStock}</ul></article>
    </div>
    <article class="panel"><h2>${t('recentActivity')}</h2>
      ${renderReportTable([t('date'), t('type'), t('item'), t('qty'), t('amount'), t('note')], movementRows, t('noTransactions'))}
    </article>`;
}

function renderCustomerReport(report) {
  const customers = customersCache;
  const merged = report.customers.topCustomers.map((row) => {
    const saved = customers.find((c) => c.name === row.name);
    return { ...row, email: saved?.email || '—', purchases: saved?.purchases || row.orders };
  });
  const avgOrder = merged.length
    ? Math.round(merged.reduce((sum, c) => sum + c.total, 0) / Math.max(merged.filter((c) => c.total > 0).length, 1))
    : 0;

  document.getElementById('stats-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalCustomersKpi')}</span><strong>${Math.max(customers.length, merged.length)}</strong><span class="kpi-sub">${t('totalCustomersSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('activeBuyersKpi')}</span><strong>${report.customers.activeBuyers}</strong><span class="kpi-sub">${t('activeBuyersSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('avgOrderValue')}</span><strong>${formatMoney(avgOrder)}</strong><span class="kpi-sub">${t('avgOrderValueSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('completedOrdersKpi')}</span><strong>${report.sales.completedOrders}</strong><span class="kpi-sub">${t('completedOrdersSub')}</span></div></div></div>`;

  const customerRows = merged.map((c) => `<tr>
    <td><strong>${escapeHtml(c.name)}</strong></td>
    <td>${escapeHtml(c.phone || '—')}</td>
    <td>${escapeHtml(c.email)}</td>
    <td>${escapeHtml(c.orders)}</td>
    <td>${formatMoney(c.total)}</td>
  </tr>`);

  const orderRows = report.customers.recentOrders.map((o) => `<tr>
    <td>${escapeHtml(o.orderNumber)}</td>
    <td>${new Date(o.createdAt).toLocaleDateString()}</td>
    <td>${escapeHtml(o.customerName)}</td>
    <td>${orderStatusBadge(o.status)}</td>
    <td>${formatMoney(o.totalAmount)}</td>
  </tr>`);

  document.getElementById('report-body').innerHTML = `
    <article class="panel"><h2>${t('topCustomers')}</h2>
      ${renderReportTable([t('name'), t('customerPhone'), t('email'), t('totalOrdersKpi'), t('total')], customerRows, t('noCustomersInPeriod'))}
    </article>
    <article class="panel"><h2>${t('recentOrders')}</h2>
      ${renderReportTable([t('receiptNo'), t('orderDate'), t('customer'), t('status'), t('total')], orderRows, t('noOrdersInPeriod'))}
    </article>`;
}

function exportReportSummary() {
  if (!reportCache) return;
  const { start, end } = reportDateRange();
  const expenses = expensesInRange(start, end);
  const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netProfit = reportCache.sales.revenue - expenseTotal;
  const lines = [
    'Suvarnapasal Financial Summary',
    `Period,${start || 'All'},${end || 'All'}`,
    `Report Type,${reportTab}`,
    `Total Revenue (${currencyCode()}),${formatMoneyPlain(reportCache.sales.revenue)}`,
    `Total Expenses (${currencyCode()}),${formatMoneyPlain(expenseTotal)}`,
    `Net Profit (${currencyCode()}),${formatMoneyPlain(netProfit)}`,
    ...(reportCache.receivedTotal != null ? [
      `Payments Received (${currencyCode()}),${formatMoneyPlain(reportCache.receivedTotal)}`,
      `Profit: Received - Expenses (${currencyCode()}),${formatMoneyPlain(reportCache.receivedTotal - expenseTotal)}`,
    ] : []),
    `Total Orders,${reportCache.sales.totalOrders}`,
    `Completed Orders,${reportCache.sales.completedOrders}`,
    `Inventory Value (${currencyCode()}),${formatMoneyPlain(reportCache.inventory.totalInventoryValue)}`,
    ''
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `suvarnapasal-report-${start || 'all'}-${end || 'all'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast(t('reportExported'));
}

// Money actually collected in the period: checkout receipts (received − change)
// for sales made in the range, plus later credit receipts whose payment date
// falls in the range — even when the original sale is older.
function computeReceivedTotal(allSales, start, end) {
  const inRange = (d) => {
    const day = String(d || '').slice(0, 10);
    if (!day) return false;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  };
  let total = 0;
  for (const s of allSales || []) {
    if (s.status === 'voided') continue;
    if (inRange(s.createdAt)) {
      const rec = Number(s.payment?.received) || 0;
      const change = Number(s.payment?.change) || 0;
      total += Math.max(0, rec - change);
    }
    for (const p of s.payments || []) {
      if (inRange(p.date || p.createdAt)) total += Number(p.amount) || 0;
    }
  }
  return total;
}

async function loadReports() {
  const { start, end } = reportDateRange();
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);

  const report = await api(`/api/reports?${params}`);
  applyMetalRatesFromResponse(report);
  reportCache = report;
  const expenses = expensesInRange(start, end);
  const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netProfit = report.sales.revenue - expenseTotal;

  // Received-payments total for the Profit KPI (tolerates failure quietly).
  try {
    const salesResp = await api('/api/sales');
    report.receivedTotal = computeReceivedTotal(salesResp.sales, start, end);
  } catch (_) {
    report.receivedTotal = null;
  }

  await updateMetalRates({
    priceMode: settingsPriceMode,
    goldRatePerTola: goldRateCache,
    goldRatePerGram: Number((goldRateCache / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola: silverRateCache,
    silverRatePerGram: Number((silverRateCache / TOLA_GRAMS).toFixed(2))
  });

  updateReportSectionTitle();
  if (reportTab === 'inventory') renderInventoryReport(report);
  else if (reportTab === 'customer') renderCustomerReport(report);
  else if (reportTab === 'invoices' && typeof renderInvoicesReport === 'function') renderInvoicesReport();
  else renderSalesReport(report, expenseTotal, netProfit);
}

async function loadInventory() {
  const q = document.getElementById('search-items')?.value.trim() || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const payload = await api(`/api/items?${params}`);
  applyMetalRatesFromResponse(payload);
  itemsCache = payload.items;

  const countEl = document.getElementById('inventory-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, payload.items.length);

  renderInventoryTable();
}

function renderOrderRows(orders) {
  const now = new Date();
  return orders.map((o) => {
    const due = orderDueDate(o);
    const isActive = o.status !== 'completed' && o.status !== 'cancelled';
    const isOverdue = isActive && due < now;
    const daysLeft = Math.ceil((due - now) / 86400000);
    let dueDisplay;
    if (isOverdue) {
      dueDisplay = `<div style="color:var(--danger,#dc2626);font-weight:600;font-size:.85rem">${due.toLocaleDateString()}</div><div style="font-size:.7rem;color:#dc2626">⚠ ${Math.abs(daysLeft)}d overdue</div>`;
    } else if (isActive && daysLeft <= 3) {
      dueDisplay = `<div style="color:var(--warning,#d97706);font-weight:600;font-size:.85rem">${due.toLocaleDateString()}</div><div style="font-size:.7rem;color:#d97706">${daysLeft}d left</div>`;
    } else {
      dueDisplay = `<div style="font-size:.85rem">${due.toLocaleDateString()}</div>`;
    }
    const karigarCell = o.karigarName
      ? `<td style="font-size:.82rem">${escapeHtml(o.karigarName)}</td>`
      : `<td style="opacity:.3;font-size:.82rem">—</td>`;
    const advanceAmt = Number(o.advanceAmount) || 0;
    const goldGiven = Number(o.customerGoldGrams) || 0;
    const goldAdded = Number(o.goldAddedGrams) || 0;
    const hasPaymentInfo = advanceAmt > 0 || goldGiven > 0 || goldAdded > 0 || o.advancePaid || o.remainingPayment != null;
    const leftPay = o.remainingPayment != null
      ? Number(o.remainingPayment) || 0
      : Math.max(0, (Number(o.totalAmount) || 0) - advanceAmt);
    const paymentBits = [];
    if (advanceAmt > 0) {
      paymentBits.push(`<div style="font-size:.78rem;font-weight:700;color:${o.advancePaid ? '#059669' : '#d97706'}">${o.advancePaid ? '✓ Adv.' : 'Adv.'} ${formatMoney(advanceAmt)}</div>`);
    } else if (o.advancePaid) {
      paymentBits.push(`<div style="font-size:.78rem;font-weight:700;color:#059669">✓ Adv. paid</div>`);
    }
    if (goldGiven > 0) paymentBits.push(`<div style="font-size:.72rem;opacity:.75">Given ${goldGiven}g</div>`);
    if (goldAdded > 0) paymentBits.push(`<div style="font-size:.72rem;opacity:.75">Added ${goldAdded}g</div>`);
    if (hasPaymentInfo) {
      paymentBits.push(`<div style="font-size:.72rem;font-weight:600;opacity:.85">Left ${formatMoney(leftPay)}</div>`);
    }
    const advanceCell = paymentBits.length
      ? `<td>${paymentBits.join('')}</td>`
      : `<td style="opacity:.3;font-size:.82rem">—</td>`;
    return `<tr${isOverdue ? ' style="background:rgba(220,38,38,.04)"' : ''}>
      <td><input type="checkbox" aria-label="Select row" /></td>
      <td><strong>${escapeHtml(o.orderNumber)}</strong><div style="font-size:.72rem;opacity:.5;margin-top:.1rem">${new Date(o.createdAt).toLocaleDateString()}</div></td>
      <td>${dueDisplay}</td>
      <td>${escapeHtml(o.customerName)}</td>
      <td style="font-size:.8rem;max-width:180px;white-space:normal;line-height:1.3">${escapeHtml(orderItemsSummary(o))}</td>
      ${karigarCell}
      ${advanceCell}
      <td style="font-weight:700">${formatMoney(o.totalAmount)}</td>
      <td>${orderStatusBadge(o.status)}</td>
      <td class="options-cell order-actions-cell">${orderActionButtons(o) || '—'}</td>
    </tr>`;
  }).join('');
}

function renderOrdersTable(orders) {
  if (!orders.length) return ordersEmptyTable();
  return `<div class="table-wrap"><table class="data-table">${ordersTableHead()}<tbody>${renderOrderRows(orders)}</tbody></table></div>`;
}

function ordersForActiveGroup() {
  const search = getOrdersSearchQuery();
  let list = ordersAllCache;
  if (search) list = filterOrdersBySearch(list, search);
  const statuses = ORDER_GROUPS.find((g) => g.id === orderGroup)?.statuses || [];
  return sortOrdersForDisplay(list.filter((o) => statuses.includes(o.status)));
}

function renderOrdersView() {
  const countEl = document.getElementById('orders-row-count');
  const contentEl = document.getElementById('orders-content');
  if (!contentEl) return;

  const search = getOrdersSearchQuery();
  const group = ORDER_GROUPS.find((g) => g.id === orderGroup) || ORDER_GROUPS[0];
  const filtered = ordersForActiveGroup();
  updateOrderGroupTabsUI();

  const headerTitle = search
    ? `${t('searchResults')} · ${t(group.labelKey)}`
    : t(group.labelKey);

  contentEl.innerHTML = `
    <header class="order-group-head order-group-head-single">
      <div class="order-group-title">
        <span class="order-group-dot order-group-dot-${group.id}"></span>
        <h3>${headerTitle}</h3>
      </div>
      <span class="order-group-count">${filtered.length}</span>
    </header>
    ${filtered.length ? renderOrdersTable(filtered) : ordersEmptyTable()}`;

  if (countEl) countEl.textContent = rowCountLabel(0, filtered.length);
}

function setOrderGroup(groupId) {
  orderGroup = groupId;
  renderOrdersView();
}

async function loadOrders() {
  const countEl = document.getElementById('orders-row-count');
  const contentEl = document.getElementById('orders-content');

  try {
    const [ordersPayload, itemsPayload] = await Promise.all([
      api('/api/orders'),
      api('/api/items')
    ]);
    ordersAllCache = ordersPayload.orders;
    orderItemsCache = itemsPayload.items.filter((i) => i.quantity > 0);
    applyMetalRatesFromResponse(ordersPayload);
    applyMetalRatesFromResponse(itemsPayload);

    const select = document.getElementById('order-item-select');
    if (select) populateOrderItemSelect();

    applyOrdersSearch();
    if (activeView === 'customers') loadCustomers().catch(() => {});
    if (activeView === 'karigar' && typeof renderKarigarView === 'function') renderKarigarView();
  } catch (err) {
    ordersAllCache = [];
    if (countEl) countEl.textContent = rowCountLabel(0, 0);
    if (contentEl) contentEl.innerHTML = ordersEmptyTable();
    errorToast(t('errorTitle'), t('ordersLoadError'));
  }
}

function renderCustomersTable() {
  const search = document.getElementById('search-customers')?.value.trim().toLowerCase() || '';
  const filter = document.getElementById('filter-customers')?.value.trim().toLowerCase() || '';
  const customers = customersCache.filter((c) => {
    const hay = `${c.name} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (filter && !c.name.toLowerCase().includes(filter)) return false;
    return true;
  });
  const countEl = document.getElementById('customers-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, customers.length);
  const tableEl = document.getElementById('customers-table');
  if (!tableEl) return;
  tableEl.innerHTML = customers.length
    ? `<table class="data-table"><thead><tr>
        <th><input type="checkbox" disabled /></th>
        <th>${t('name')}</th><th>${t('customerPhone')}</th><th>${t('email')}</th>
        <th>${t('address')}</th><th>${t('purchaseActivity')}</th><th></th>
      </tr></thead><tbody>
      ${customers.map((c) => `<tr>
        <td><input type="checkbox" /></td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone || '—')}</td><td>${escapeHtml(c.email || '—')}</td><td>${escapeHtml(c.address || '—')}</td>
        <td>${escapeHtml(c.purchases || 0)} ${t('sale').toLowerCase()}(s)</td>
        <td><button type="button" class="link-btn danger" data-customer-delete="${escapeHtml(c.id)}">${t('delete')}</button></td>
      </tr>`).join('')}
    </tbody></table>`
    : `<table class="data-table"><tbody><tr class="empty-row"><td colspan="7">${t('noResults')}</td></tr></tbody></table>`;
}

async function migrateLocalCustomersOnce() {
  if (localCustomersMigrated) return;
  localCustomersMigrated = true;
  const legacy = localData('subarnapasal.customers', []);
  if (!legacy.length) return;
  for (const row of legacy) {
    try {
      await api('/api/customers/upsert', {
        method: 'POST',
        body: JSON.stringify({
          name: row.name,
          phone: row.phone || '',
          email: row.email || '',
          address: row.address || ''
        })
      });
    } catch (_) { /* skip failed legacy row */ }
  }
  try { localStorage.removeItem('subarnapasal.customers'); } catch (_) { /* ignore */ }
}

async function upsertCustomerActivity(customer) {
  const name = String(customer?.name || '').trim();
  if (!name) return;
  try {
    const payload = await api('/api/customers/upsert', {
      method: 'POST',
      body: JSON.stringify({
        name,
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || ''
      })
    });
    if (Array.isArray(payload.customers)) {
      customersCache = payload.customers;
      if (activeView === 'customers') renderCustomersTable();
    }
  } catch (_) { /* background save */ }
}

async function loadCustomers() {
  try {
    await migrateLocalCustomersOnce();
    const payload = await api('/api/customers');
    customersCache = payload.customers || [];
    renderCustomersTable();
  } catch (_) {
    customersCache = localData('subarnapasal.customers', []);
    renderCustomersTable();
  }
}

function stopCustomersPolling() {
  if (customersPollTimer) {
    clearInterval(customersPollTimer);
    customersPollTimer = null;
  }
}

function syncCustomersPolling() {
  stopCustomersPolling();
  if (activeView !== 'customers') return;
  loadCustomers().catch(() => {});
  customersPollTimer = setInterval(() => {
    loadCustomers().catch(() => {});
  }, CUSTOMERS_POLL_MS);
}

function seedSampleExpenses() {
  const existing = localData('subarnapasal.expenses', []);
  if (existing.length > 0) return;
  const today = new Date();
  const d = (offset) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() - offset);
    return dt.toISOString().slice(0, 10);
  };
  const sample = [
    { id: 'exp-seed-01', date: d(90), category: 'Rent / Lease', description: 'April shop rent - New Road', amount: 45000 },
    { id: 'exp-seed-02', date: d(60), category: 'Rent / Lease', description: 'May shop rent - New Road', amount: 45000 },
    { id: 'exp-seed-03', date: d(30), category: 'Rent / Lease', description: 'June shop rent - New Road', amount: 45000 },
    { id: 'exp-seed-04', date: d(85), category: 'Salaries', description: 'Staff salaries - April', amount: 55000 },
    { id: 'exp-seed-05', date: d(55), category: 'Salaries', description: 'Staff salaries - May', amount: 55000 },
    { id: 'exp-seed-06', date: d(25), category: 'Salaries', description: 'Staff salaries - June', amount: 55000 },
    { id: 'exp-seed-07', date: d(80), category: 'Electricity / Utilities', description: 'Electricity bill - April', amount: 4200 },
    { id: 'exp-seed-08', date: d(50), category: 'Electricity / Utilities', description: 'Electricity bill - May', amount: 3800 },
    { id: 'exp-seed-09', date: d(20), category: 'Electricity / Utilities', description: 'Electricity bill - June', amount: 4100 },
    { id: 'exp-seed-10', date: d(75), category: 'Security', description: 'Security guard service - April', amount: 12000 },
    { id: 'exp-seed-11', date: d(45), category: 'Security', description: 'Security guard service - May', amount: 12000 },
    { id: 'exp-seed-12', date: d(15), category: 'Security', description: 'Security guard service - June', amount: 12000 },
    { id: 'exp-seed-13', date: d(70), category: 'Marketing & Advertising', description: 'Facebook ads - April campaign', amount: 8500 },
    { id: 'exp-seed-14', date: d(40), category: 'Marketing & Advertising', description: 'Hoardings & brochures', amount: 6000 },
    { id: 'exp-seed-15', date: d(65), category: 'Packaging', description: 'Jewellery boxes & velvet pouches', amount: 5200 },
    { id: 'exp-seed-16', date: d(35), category: 'Packaging', description: 'Gift bags and tissue', amount: 2800 },
    { id: 'exp-seed-17', date: d(28), category: 'Insurance', description: 'Annual shop insurance premium', amount: 18000 },
    { id: 'exp-seed-18', date: d(10), category: 'Tax / VAT', description: 'VAT filing - Q2 2026', amount: 22000 },
    { id: 'exp-seed-19', date: d(18), category: 'Repairs & Maintenance', description: 'Showcase glass replacement', amount: 3500 },
    { id: 'exp-seed-20', date: d(8), category: 'Transport & Delivery', description: 'Delivery charges - customer orders', amount: 1800 },
    { id: 'exp-seed-21', date: d(5), category: 'Miscellaneous', description: 'Stationery and office supplies', amount: 1200 },
    { id: 'exp-seed-22', date: d(3), category: 'Electricity / Utilities', description: 'Internet & telephone bill', amount: 2400 }
  ];
  saveLocalData('subarnapasal.expenses', sample);
}

const EXPENSE_CAT_COLORS = {
  'Rent / Lease': '#b8860b',
  'Salaries': '#4f46e5',
  'Electricity / Utilities': '#0891b2',
  'Raw Materials': '#059669',
  'Marketing & Advertising': '#db2777',
  'Packaging': '#d97706',
  'Security': '#7c3aed',
  'Insurance': '#dc2626',
  'Tax / VAT': '#ef4444',
  'Repairs & Maintenance': '#0f766e',
  'Transport & Delivery': '#1d4ed8',
  'Miscellaneous': '#6b7280'
};

function expenseCategoryColor(cat) {
  return EXPENSE_CAT_COLORS[cat] || '#6b7280';
}

function loadExpenses() {
  const filter = document.getElementById('filter-expenses')?.value.trim().toLowerCase() || '';
  const start = document.getElementById('expense-start')?.value;
  const end = document.getElementById('expense-end')?.value;
  let allExpenses = localData('subarnapasal.expenses', []);
  const expenses = allExpenses.filter((e) => {
    if (filter && !`${e.category} ${e.description}`.toLowerCase().includes(filter)) return false;
    if (start && e.date < start) return false;
    if (end && e.date > end) return false;
    return true;
  });
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  document.getElementById('expense-total').textContent = formatMoney(total);
  const countEl = document.getElementById('expenses-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, expenses.length);

  const summaryEl = document.getElementById('expense-category-summary');
  if (summaryEl && expenses.length) {
    const catMap = {};
    for (const e of expenses) { catMap[e.category] = (catMap[e.category] || 0) + Number(e.amount || 0); }
    const cats = Object.entries(catMap).sort(([, a], [, b]) => b - a);
    const safeTotal = total || 1;
    summaryEl.innerHTML = `
      <div style="margin-bottom:.5rem">
        <div style="display:flex;height:8px;border-radius:99px;overflow:hidden;gap:1px;margin-bottom:.6rem">
          ${cats.map(([cat, amt]) => `<div style="width:${Math.max(2, Math.round((amt / safeTotal) * 100))}%;background:${expenseCategoryColor(cat)};flex-shrink:0" title="${escapeHtml(cat)}: ${formatMoney(amt)}"></div>`).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem">
          ${cats.map(([cat, amt]) => {
            const pct = Math.round((amt / safeTotal) * 100);
            return `<div style="display:inline-flex;align-items:center;gap:.3rem;background:${expenseCategoryColor(cat)}18;border:1px solid ${expenseCategoryColor(cat)}44;padding:.2rem .55rem;border-radius:99px;font-size:.78rem">
              <span style="width:7px;height:7px;border-radius:50%;background:${expenseCategoryColor(cat)};flex-shrink:0"></span>
              <span style="font-weight:600">${escapeHtml(cat)}</span>
              <span style="opacity:.7">${formatMoney(amt)}</span>
              <span style="opacity:.45">${pct}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    summaryEl.hidden = false;
  } else if (summaryEl) {
    summaryEl.hidden = true;
  }

  document.getElementById('expenses-table').innerHTML = expenses.length
    ? `<table class="data-table"><thead><tr>
        <th>${t('date')}</th><th>${t('category')}</th><th>${t('description')}</th>
        <th style="text-align:right">${t('amount')}</th><th></th>
      </tr></thead><tbody>
      ${expenses.map((e) => {
        const col = expenseCategoryColor(e.category);
        return `<tr>
          <td style="font-size:.82rem;white-space:nowrap">${escapeHtml(e.date)}</td>
          <td><span style="display:inline-flex;align-items:center;gap:.3rem;background:${col}18;border:1px solid ${col}33;padding:.15rem .5rem;border-radius:99px;font-size:.78rem;font-weight:600;color:${col}">
            <span style="width:6px;height:6px;border-radius:50%;background:${col};flex-shrink:0"></span>${escapeHtml(e.category)}
          </span></td>
          <td style="font-size:.85rem;opacity:.8">${escapeHtml(e.description)}</td>
          <td style="text-align:right;font-weight:700">${formatMoney(Number(e.amount))}</td>
          <td><button type="button" class="link-btn danger" data-expense-delete="${escapeHtml(e.id)}">${t('delete')}</button></td>
        </tr>`;
      }).join('')}
    </tbody></table>`
    : `<table class="data-table"><tbody><tr class="empty-row"><td colspan="5">${t('noResults')}</td></tr></tbody></table>`;
}

function updateOrderItemWeightPreview() {
  const form = document.getElementById('order-form');
  const preview = document.getElementById('order-item-weight-preview');
  if (!form || !preview || isOrderCustomItemMode(form)) {
    if (preview) preview.hidden = true;
    return;
  }
  const item = orderItemsCache.find((i) => i.id === form.itemId?.value);
  if (!item?.weightGrams) {
    preview.hidden = true;
    return;
  }
  preview.hidden = false;
  const bits = [`Weight: ${formatWeightParts(item.weightGrams)}`];
  if (item.jartiRateValue > 0) {
    bits.push(`Jarti: ${item.jartiRateType || 'flat'} ${item.jartiRateValue}`);
  }
  preview.textContent = bits.join(' · ');
}

function updateOrderTotalPreview() {
  const form = document.getElementById('order-form');
  if (!form) return;
  const totalEl = document.getElementById('order-total-preview');
  const qty = Number(form.quantity.value) || 1;
  const breakdownEl = document.getElementById('order-price-breakdown');
  if (isOrderCustomItemMode(form)) {
    const weightGrams = getWeightGramsFromForm(form, 'custom');
    const weightUnit = getWeightUnit(form, 'custom');
    const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, 'custom') : null;
    const hasWeight = weightUnit === 'tola'
      ? Boolean(tolaParts && (tolaParts.tola || tolaParts.aana || tolaParts.laal))
      : weightGrams > 0;
    if (!hasWeight) {
      if (totalEl) totalEl.value = '';
      if (breakdownEl) {
        breakdownEl.hidden = true;
        breakdownEl.innerHTML = '';
      }
      updateOrderRemainingPreview();
      return;
    }
    const jartiRateType = form.customJartiRateType?.value || 'percent';
    const jartiGramsFromForm = getOrderJartiGramsFromForm(form);
    const jartiRateValue = jartiRateType === 'percent'
      ? (Number(form.customJartiRateValue?.value) || 0)
      : jartiGramsFromForm;
    syncOrderJartiPanels(form);
    const unitTotal = calcItemLinePrice({
      category: form.customCategory?.value || 'gold',
      karat: Number(form.customKarat?.value) || 24,
      weightGrams,
      makingCharge: parseMoneyField(form.customMakingCharge?.value) || 0,
      customRatePerTola: parseMoneyField(form.customRatePerTola?.value) || 0,
      jartiRateType: jartiRateType === 'percent' ? 'percent' : 'grams',
      jartiRateValue
    }, { weightUnit, tolaParts });
    if (unitTotal == null) {
      if (totalEl) totalEl.value = '—';
      if (breakdownEl) {
        breakdownEl.hidden = true;
        breakdownEl.innerHTML = '';
      }
      updateOrderJartiPreview(form, {
        weightGrams,
        jartiRateType: jartiRateType === 'percent' ? 'percent' : 'grams',
        jartiRateValue,
        jartiWeightGrams: jartiGramsFromForm
      });
      updateOrderRemainingPreview();
      return;
    }
    if (totalEl) totalEl.value = formatMoney(unitTotal * qty);
    if (breakdownEl) {
      const metal = itemMetalType(form.customCategory?.value || 'gold');
      const rateNpr = metal === 'silver'
        ? silverRateCache
        : metal === 'other'
          ? parseMoneyField(form.customRatePerTola?.value) || 0
          : getGoldRatePerTolaNpr();
      const karatFactor = metal === 'gold' ? (Number(form.customKarat?.value) || 24) / 24 : 1;
      updateOrderJartiPreview(form, {
        weightGrams,
        ratePerTola: rateNpr,
        karatFactor,
        jartiRateType: jartiRateType === 'percent' ? 'percent' : 'grams',
        jartiRateValue,
        jartiWeightGrams: jartiGramsFromForm
      });
      const html = rateNpr > 0 ? renderOrderPriceBreakdown({
        weightUnit,
        weightGrams,
        tolaParts,
        makingChargeNpr: parseMoneyField(form.customMakingCharge?.value) || 0,
        qty,
        ratePerTolaNpr: rateNpr,
        jartiRateType: jartiRateType === 'percent' ? 'percent' : 'grams',
        jartiRateValue,
        karatFactor
      }) : '';
      breakdownEl.innerHTML = html;
      breakdownEl.hidden = !html;
    } else {
      updateOrderJartiPreview(form, {
        weightGrams,
        jartiRateType: jartiRateType === 'percent' ? 'percent' : 'grams',
        jartiRateValue,
        jartiWeightGrams: jartiGramsFromForm
      });
    }
    updateOrderRemainingPreview();
    return;
  }
  if (breakdownEl) {
    breakdownEl.hidden = true;
    breakdownEl.innerHTML = '';
  }
  const item = orderItemsCache.find((i) => i.id === form.itemId?.value);
  if (!item || !totalEl) {
    if (totalEl) totalEl.value = '';
    updateOrderItemWeightPreview();
    updateOrderRemainingPreview();
    return;
  }
  totalEl.value = formatMoney(getItemDisplayPrice(item) * qty);
  updateOrderItemWeightPreview();
  updateOrderRemainingPreview();
}

function parseOrderPreviewTotal(form) {
  const totalEl = document.getElementById('order-total-preview');
  const raw = String(totalEl?.value || '').trim();
  if (!raw || raw === '—') return 0;
  const parsed = parseMoneyField(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function updateOrderRemainingPreview(force = false) {
  const form = document.getElementById('order-form');
  const remainingEl = form?.remainingPayment || document.getElementById('order-remaining-preview');
  if (!form || !remainingEl) return;
  if (!force && remainingEl.dataset.manual === '1') return;
  const total = parseOrderPreviewTotal(form);
  const advanceRaw = String(form.advanceAmount?.value || '').trim();
  const advance = advanceRaw === '' ? 0 : (parseMoneyField(advanceRaw) || 0);
  // Only auto-fill left payment when advance is entered or total is known with an advance value.
  if (advanceRaw === '' && !force) {
    if (remainingEl.dataset.manual !== '1') remainingEl.value = '';
    return;
  }
  const left = Math.max(0, total - advance);
  remainingEl.value = total || advance ? String(left) : '';
  remainingEl.dataset.manual = '0';
}

async function updateOrderStatus(orderId, status) {
  await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  toast(t('orderUpdated'));
}

function itemPayloadFromForm(form, fd) {
  const quantity = Math.max(0, Number(fd.get('quantity')) || 0);
  const status = fd.get('status') || 'in_stock';
  return {
    sku: String(fd.get('sku') || '').trim() || generateSku(),
    name: String(fd.get('name') || '').trim(),
    category: fd.get('category') || 'gold',
    karat: Number(fd.get('karat')) || 24,
    weightGrams: getWeightGramsFromForm(form, ''),
    weightUnit: getWeightUnit(form, ''),
    makingCharge: parseMoneyField(fd.get('makingCharge') || 0),
    purchaseCost: parseMoneyField(fd.get('purchaseCost') || 0),
    salePrice: fd.get('salePrice') ? parseMoneyField(fd.get('salePrice')) : 0,
    customRatePerTola: parseMoneyField(fd.get('customRatePerTola') || 0),
    quantity: status === 'sold_out' ? 0 : quantity,
    status,
    location: String(fd.get('location') || '').trim(),
    jartiRateType: String(fd.get('jartiRateType') || 'flat'),
    jartiRateValue: Number(fd.get('jartiRateValue')) || 0,
    hallmarkNumber: '',
    hallmarkDate: '',
    hallmark: false,
    hsCode: String(fd.get('hsCode') || '').trim(),
    stoneAmount: parseMoneyField(fd.get('stoneAmount') || 0),
    notes: String(fd.get('notes') || '').trim()
  };
}

function openItemModal(item) {
  if (item && isItemSoldOut(item)) {
    toast(t('soldOutItemNotEditable'));
    return;
  }
  editingId = item?.id || null;
  document.getElementById('modal-title').textContent = item ? t('editItemTitle') : t('addItemTitle');
  const form = document.getElementById('item-form');
  form.reset();
  renderCategorySelect(form.category, { defaultValue: 'gold' });
  syncItemMetalFields(form, METAL_FIELD_PRESETS.inventory);
  if (item) {
    Object.entries(item).forEach(([k, v]) => {
      if (k === 'weightGrams') return;
      const field = form.elements[k];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = Boolean(v);
      else if (['makingCharge', 'purchaseCost', 'salePrice', 'customRatePerTola', 'stoneAmount'].includes(k)) field.value = formatMoneyField(v);
      else field.value = v;
    });
    ensureCategoryOption(form.category, item.category);
    form.category.value = item.category || 'gold';
    form.sku.value = item.sku || generateSku();
    setWeightFieldsFromGrams(form, item.weightGrams, '');
    syncWeightEntryPanels(form, '');
  } else {
    form.category.value = 'gold';
    form.sku.value = generateSku();
    form.karat.value = '24';
    form.makingCharge.value = 0;
    form.quantity.value = 1;
    if (form.elements.weightUnit) form.elements.weightUnit.value = 'grams';
    syncWeightEntryPanels(form, '');
    setWeightFieldsFromGrams(form, '', '');
  }
  updateItemPricePreview();
  document.getElementById('item-modal').showModal();
}

function nextBillNumber() {
  return `BILL-${Date.now().toString().slice(-8)}`;
}

function getBillOptions() {
  return {
    billStyle: document.getElementById('bill-style-select')?.value || 'guarantee',
    showSign: document.getElementById('bill-show-sign')?.checked !== false,
    showCustomerSign: document.getElementById('bill-show-customer-sign')?.checked !== false,
    showStamp: document.getElementById('bill-show-stamp')?.checked !== false,
    signatoryName: document.getElementById('bill-signatory-name')?.value.trim()
      || settingsCache.shopName
      || 'Suvarnapasal'
  };
}

function billSignaturesBlock(sale, options) {
  if (!options.showSign && !options.showCustomerSign) return '';
  const blocks = [];
  if (options.showCustomerSign) {
    blocks.push(`
      <div class="bill-sign-block bill-sign-block-customer">
        <div class="bill-sign-line bill-sign-line-blank" aria-hidden="true"></div>
        <span class="bill-sign-label">${t('customerSignature')}</span>
      </div>`);
  }
  if (options.showSign) {
    blocks.push(`
      <div class="bill-sign-block bill-sign-block-authorized">
        <div class="bill-sign-line">
          <span class="bill-sign-name">${escapeHtml(options.signatoryName)}</span>
        </div>
        <span class="bill-sign-label">${t('authorizedSignatory')}</span>
      </div>`);
  }
  return `<div class="bill-signatures bill-signatures-dual">${blocks.join('')}</div>`;
}

function billStampBlock(options) {
  if (!options.showStamp) return '';
  const shopShort = (options.signatoryName || 'SP').split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return `
    <div class="bill-stamp" aria-hidden="true">
      <div class="bill-stamp-ring">
        <span class="bill-stamp-top">${escapeHtml(shopShort)}</span>
        <strong class="bill-stamp-center">${t('billStampPaid')}</strong>
        <span class="bill-stamp-bottom">${new Date().getFullYear()}</span>
      </div>
    </div>`;
}

// Render the bill date according to the shop's chosen calendar (Settings):
// 'ad' = English only, 'bs' = Nepali (Miti) only, 'both' = English + Nepali.
function billDateHtml(sale) {
  const mode = sale.calendarMode || 'both';
  const bs = sale.nepaliDate;
  if (mode === 'bs' && bs) {
    return `<strong>${bs}</strong><span class="bill-meta-sub">${t('mitiLabel')}</span>`;
  }
  if (mode === 'ad' || !bs) {
    return `<strong>${sale.date}</strong>`;
  }
  return `<strong>${sale.date}</strong><span class="bill-meta-sub">${t('mitiLabel')}: ${bs}</span>`;
}

function buildBillHtml(sale, options = getBillOptions()) {
  if (options.billStyle !== 'classic') return buildGuaranteeBillHtml(sale, options);
  const lineRows = sale.lines.map((line, i) => {
    const meta = [lineMetalLabel(line), line.sku, line.karat ? `${line.karat}K` : '', line.weightGrams ? `${line.weightGrams}g` : '']
      .filter(Boolean)
      .join(' · ');
    return `<tr>
      <td class="bill-num">${i + 1}</td>
      <td>
        <strong class="bill-item-name">${escapeHtml(cartLineName(line))}</strong>
        ${meta ? `<span class="bill-line-meta">${escapeHtml(meta)}</span>` : ''}
      </td>
      <td>${escapeHtml(line.qty)}</td>
      <td>${formatMoney(line.price)}</td>
      <td>${formatMoney(line.price * line.qty)}</td>
    </tr>`;
  }).join('');

  return `
    <article class="bill-receipt bill-receipt-premium">
      <div class="bill-frame">
        <div class="bill-corner bill-corner-tl"></div>
        <div class="bill-corner bill-corner-tr"></div>
        <div class="bill-corner bill-corner-bl"></div>
        <div class="bill-corner bill-corner-br"></div>

        <header class="bill-header">
          <div class="bill-logo-wrap">
            ${shopLogoHtml('bill-logo')}
          </div>
          <div class="bill-shop">
            <strong>${escapeHtml(sale.shopName)}</strong>
            ${sale.shopAddress ? `<p>${escapeHtml(sale.shopAddress)}</p>` : ''}
            ${sale.shopPhone ? `<p>${escapeHtml(sale.shopPhone)}</p>` : ''}
            ${sale.shopPan ? `<p class="bill-shop-pan">${t('panLabel')}: ${escapeHtml(sale.shopPan)}</p>` : ''}
          </div>
          <p class="bill-receipt-type">${sale.taxAmount > 0 ? t('taxInvoice') : t('saleReceipt')}</p>
        </header>

        <div class="bill-meta-grid">
          <div class="bill-meta-cell">
            <span class="bill-label">${t('receiptNo')}</span>
            <strong>${escapeHtml(sale.billNumber)}</strong>
          </div>
          <div class="bill-meta-cell">
            <span class="bill-label">${t('date')}</span>
            ${billDateHtml(sale)}
          </div>
          <div class="bill-meta-cell bill-meta-wide">
            <span class="bill-label">${t('customer')}</span>
            <strong>${escapeHtml(sale.customer)}</strong>
            ${sale.customerPhone ? `<span class="bill-meta-sub">${escapeHtml(sale.customerPhone)}</span>` : ''}
            ${sale.customerPan ? `<span class="bill-meta-sub">${t('panLabel')}: ${escapeHtml(sale.customerPan)}</span>` : ''}
          </div>
        </div>

        <div class="bill-table-wrap">
          <table class="bill-table bill-table-premium">
            <thead>
              <tr>
                <th>#</th>
                <th>${t('name')}</th>
                <th>${t('qty')}</th>
                <th>${t('unitPrice')}</th>
                <th>${t('total')}</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>

        <div class="bill-footer-row">
          <div class="bill-totals bill-totals-premium">
            <div class="bill-total-line"><span>${t('subtotal')}</span><span>${formatMoney(sale.subtotal)}</span></div>
            ${sale.discount > 0 ? `<div class="bill-total-line bill-discount-line"><span>${t('discount')}</span><span>- ${formatMoney(sale.discount)}</span></div>` : ''}
            ${sale.taxAmount > 0 ? `<div class="bill-total-line"><span>${t('taxableAmount')}</span><span>${formatMoney(sale.afterDiscount != null ? sale.afterDiscount : (sale.subtotal - (sale.discount || 0)))}</span></div>` : ''}
            ${sale.taxAmount > 0 ? `<div class="bill-total-line"><span>${escapeHtml(sale.taxLabel)}</span><span>${formatMoney(sale.taxAmount)}</span></div>` : ''}
            ${sale.oldGoldCredit > 0 ? `<div class="bill-total-line bill-discount-line"><span>${t('oldGoldCredit')}${sale.oldGold ? ` (${escapeHtml(sale.oldGold.weightGrams)}g · ${escapeHtml(sale.oldGold.karat)}K)` : ''}</span><span>- ${formatMoney(sale.oldGoldCredit)}</span></div>` : ''}
            ${sale.schemeCredit > 0 ? `<div class="bill-total-line bill-discount-line"><span>${t('schemeCredit')}${sale.schemeNumber ? ` (${escapeHtml(sale.schemeNumber)})` : ''}</span><span>- ${formatMoney(sale.schemeCredit)}</span></div>` : ''}
            <div class="bill-total-line bill-grand-total"><span>${t('total')}</span><strong>${formatMoney(sale.total)}</strong></div>
            ${sale.paymentMethod ? `<div class="bill-total-line bill-pay-line"><span>${t('paymentMethod')}</span><span>${paymentMethodLabel(sale.paymentMethod)}</span></div>` : ''}
            ${sale.paymentMethod === 'cash' && sale.amountReceived ? `<div class="bill-total-line"><span>${t('amountReceived')}</span><span>${formatMoney(sale.amountReceived)}</span></div>` : ''}
            ${sale.changeDue > 0 ? `<div class="bill-total-line"><span>${t('changeDue')}</span><span>${formatMoney(sale.changeDue)}</span></div>` : ''}
            ${sale.balanceDue > 0 ? `<div class="bill-total-line bill-discount-line"><span>${t('balanceDue')}</span><span>${formatMoney(sale.balanceDue)}</span></div>` : ''}
          </div>
          ${billStampBlock(options)}
        </div>

        <p class="bill-amount-words"><span class="bill-label">${t('amountInWords')}:</span> ${sale.totalInWords || amountToWords(sale.total)}</p>

        ${billSignaturesBlock(sale, options)}

        <p class="bill-thanks">${t('thankYou')}</p>
        ${sale.rateSnapshot && sale.rateSnapshot.goldRatePerTola > 0
          ? `<p class="bill-footer-note">${t('rateAtSale')}: ${formatMoney(sale.rateSnapshot.goldRatePerTola)}/tola${sale.rateSnapshot.source && sale.rateSnapshot.source !== 'manual' ? ` (${t('liveRate')})` : ''}</p>`
          : ''}
        ${sale.voided ? `<p class="bill-footer-note bill-voided-note" style="color:#b91c1c;font-weight:700;letter-spacing:0.1em;">*** ${t('voidedStamp')}${sale.voidReason ? ` — ${escapeHtml(sale.voidReason)}` : ''} ***</p>` : ''}
        <p class="bill-footer-note">${t('saleReceipt')} · ${escapeHtml(sale.billNumber)}</p>
      </div>
    </article>`;
}

// ---- Guarantee bill (ग्यारेन्टी बिल) — bilingual layout matching the
// traditional Nepali jewellery-shop bill pad. ----
function gbillFmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const dt = new Date(y, m - 1, d);
  const bs = typeof toBikramSambatString === 'function' ? toBikramSambatString(dt, 'ne') : '';
  return bs ? `${bs} (${iso})` : iso;
}

function gbillWeight(g) {
  const n = Number(g) || 0;
  return n > 0 ? `${formatWeightQty(n, 3)}g` : '';
}

function buildGuaranteeBillHtml(sale, options = getBillOptions()) {
  const bill = sale.bill || {};
  let sumWeight = 0, sumJarti = 0, sumTotalWeight = 0, sumStone = 0, sumMaking = 0, sumAmount = 0;

  const lineRows = (sale.lines || []).map((line, i) => {
    const qty = Number(line.qty) || 1;
    const weight = (Number(line.weightGrams) || 0) * qty;
    const jarti = resolveJartiWeightGrams(weight, line.jartiRateType, line.jartiRateValue);
    const totalWeight = weight + jarti;
    const lineTotal = (Number(line.price) || 0) * qty;
    const stone = (Number(line.stoneAmount) || 0) * qty;
    const making = (Number(line.makingCharge) || 0) * qty;
    const metalAmount = Math.max(0, lineTotal - stone - making);
    const per10g = Number(line.ratePerTola) > 0 ? (Number(line.ratePerTola) / TOLA_GRAMS) * 10 : 0;
    sumWeight += weight; sumJarti += jarti; sumTotalWeight += totalWeight;
    sumStone += stone; sumMaking += making; sumAmount += lineTotal;
    const typeBits = [categoryLabel(line.category || 'gold'), line.karat ? `${line.karat}K` : ''].filter(Boolean).join(' ');
    return `<tr>
      <td class="gb-c">${i + 1}</td>
      <td class="gb-c">${escapeHtml(line.hsCode || '')}</td>
      <td class="gb-l">${escapeHtml(cartLineName(line))}${qty > 1 ? ` × ${qty}` : ''}</td>
      <td class="gb-c">${escapeHtml(typeBits)}</td>
      <td class="gb-r">${gbillWeight(totalWeight)}</td>
      <td class="gb-r">${jarti > 0 ? `− ${gbillWeight(jarti)}` : ''}</td>
      <td class="gb-r">${gbillWeight(totalWeight - jarti)}</td>
      <td class="gb-r">${per10g > 0 ? formatMoney(per10g) : ''}</td>
      <td class="gb-r">${formatMoney(metalAmount)}</td>
      <td class="gb-r">${stone > 0 ? formatMoney(stone) : ''}</td>
      <td class="gb-r">${making > 0 ? formatMoney(making) : ''}</td>
      <td class="gb-r">${formatMoney(lineTotal)}</td>
    </tr>`;
  }).join('');

  const blankRows = Math.max(0, 4 - (sale.lines || []).length);
  const blankRowHtml = `<tr class="gb-blank">${'<td>&nbsp;</td>'.repeat(12)}</tr>`.repeat(blankRows);

  const payBits = [];
  if (sale.paymentMethod) payBits.push(paymentMethodLabel(sale.paymentMethod));
  if (bill.chequeNo) payBits.push(`${t('chequeNo')}: ${escapeHtml(bill.chequeNo)}`);
  if (bill.qrRef) payBits.push(`${t('qrRef')}: ${escapeHtml(bill.qrRef)}`);
  if (sale.paymentMethod === 'cash' && Number(sale.amountReceived) > 0) payBits.push(`${t('amountReceived')}: ${formatMoney(sale.amountReceived)}`);

  const totalRows = [];
  totalRows.push(`<tr><td>जम्मा रकम <span>Total Amount</span></td><td>${formatMoney(sale.subtotal)}</td></tr>`);
  if (sale.discount > 0) totalRows.push(`<tr><td>छुट रकम <span>Discount Amount</span></td><td>- ${formatMoney(sale.discount)}</td></tr>`);
  totalRows.push(`<tr><td>खुद रकम <span>Net Amount</span></td><td>${formatMoney(sale.afterDiscount != null ? sale.afterDiscount : sale.subtotal - (sale.discount || 0))}</td></tr>`);
  if (sale.taxAmount > 0) totalRows.push(`<tr><td>शुल्क/कर समेत मूल्य <span>${escapeHtml(sale.taxLabel || 'VAT')}</span></td><td>${formatMoney(sale.taxAmount)}</td></tr>`);
  if (sale.skillFeeAmount > 0) totalRows.push(`<tr><td>०.५% सिप प्रवर्द्धन शुल्क <span>0.5% Skill Promotion Fee</span></td><td>${formatMoney(sale.skillFeeAmount)}</td></tr>`);
  if (sale.oldGoldCredit > 0) totalRows.push(`<tr><td>पुरानो सुन साटो <span>Old Gold Credit</span></td><td>- ${formatMoney(sale.oldGoldCredit)}</td></tr>`);
  if (sale.schemeCredit > 0) totalRows.push(`<tr><td>योजना रकम <span>Scheme Credit</span></td><td>- ${formatMoney(sale.schemeCredit)}</td></tr>`);
  totalRows.push(`<tr class="gb-grand"><td>जम्मा रकम <span>Total Amount</span></td><td>${formatMoney(sale.total)}</td></tr>`);
  if (sale.balanceDue > 0) totalRows.push(`<tr><td>बाँकी रकम <span>Balance Due</span></td><td>${formatMoney(sale.balanceDue)}</td></tr>`);

  const weightRows = [];
  weightRows.push(`<tr><td>जम्मा तौल <span>Net Weight</span></td><td>${gbillWeight(sumTotalWeight) || '—'}</td></tr>`);
  if (bill.oldWeightGrams > 0) weightRows.push(`<tr><td>पुरानो तौल <span>Old Weight</span></td><td>${gbillWeight(bill.oldWeightGrams)}</td></tr>`);
  if (bill.addWeightGrams > 0) weightRows.push(`<tr><td>थप तौल <span>Add Weight</span></td><td>${gbillWeight(bill.addWeightGrams)}</td></tr>`);

  return `
    <article class="bill-receipt gbill">
      <header class="gbill-head">
        <div class="gbill-head-left">
          ${sale.shopPan ? `<div class="gbill-pan-box">प्यान नं. <strong>${escapeHtml(sale.shopPan)}</strong></div>` : ''}
          <div class="gbill-billno">बिल नं. <strong>${escapeHtml(sale.billNumber)}</strong></div>
        </div>
        <div class="gbill-head-center">
          <h1 class="gbill-shop-name">${escapeHtml(sale.shopName || '')}</h1>
          ${sale.shopAddress ? `<p class="gbill-shop-line">${escapeHtml(sale.shopAddress)}</p>` : ''}
          <p class="gbill-badge">ग्यारेन्टी बिल <span>Guarantee Bill</span></p>
        </div>
        <div class="gbill-head-right">
          ${sale.shopPhone ? `<p class="gbill-shop-line">☎ ${escapeHtml(sale.shopPhone)}</p>` : ''}
          <p class="gbill-shop-line">मिति <span>Date</span>: ${sale.nepaliDate ? `${sale.nepaliDate}` : ''} ${sale.date || ''}</p>
          <p class="gbill-shop-line">अर्डर मिति <span>Order Date</span>: ${gbillFmtDate(bill.orderDate) || '—'}</p>
          <p class="gbill-shop-line">डेलिभरी मिति <span>Delivery Date</span>: ${gbillFmtDate(bill.deliveryDate) || '—'}</p>
        </div>
      </header>

      <div class="gbill-customer">
        <p class="gbill-cust-line gbill-cust-name">श्री <span>Name</span>: <strong>${escapeHtml(sale.customer || '')}</strong></p>
        <p class="gbill-cust-line">ठेगाना <span>Address</span>: ${escapeHtml(bill.buyerAddress || '')}</p>
        <p class="gbill-cust-line">फोन नं. <span>Contact No.</span>: ${escapeHtml(sale.customerPhone || '')}</p>
        <p class="gbill-cust-line">ग्राहकको प्यान नं. <span>Buyer's PAN</span>: ${escapeHtml(sale.customerPan || '')}</p>
        <p class="gbill-cust-line">ग्राहकको परिचय पत्र नं. <span>Buyer's Identity No.</span>: ${escapeHtml(bill.buyerIdNo || '')}</p>
      </div>

      <table class="gbill-table">
        <thead>
          <tr>
            <th>क्र.सं.<span>S.N.</span></th>
            <th>एच.एस.कोड<span>H.S.Code</span></th>
            <th class="gbill-th-particulars">विवरण<span>Particulars</span></th>
            <th>किसिम<span>Type</span></th>
            <th>जम्मा तौल<span>Total Weight</span></th>
            <th>जर्ती<span>Jarti</span></th>
            <th>अन्तिम तौल<span>Final Weight</span></th>
            <th>प्रति १० ग्राम दर<span>Per 10g Rate</span></th>
            <th>रकम<span>Amount</span></th>
            <th>पत्थर<span>Stone</span></th>
            <th>निर्माण शुल्क<span>Making Cost</span></th>
            <th>जम्मा रकम<span>Total Amount</span></th>
          </tr>
        </thead>
        <tbody>
          ${lineRows}
          ${blankRowHtml}
          <tr class="gbill-sum">
            <td colspan="4" class="gb-r">जम्मा <span>Total</span></td>
            <td class="gb-r">${gbillWeight(sumTotalWeight)}</td>
            <td class="gb-r">${sumJarti > 0 ? `− ${gbillWeight(sumJarti)}` : ''}</td>
            <td class="gb-r">${gbillWeight(sumTotalWeight - sumJarti)}</td>
            <td></td>
            <td class="gb-r">${formatMoney(Math.max(0, sumAmount - sumStone - sumMaking))}</td>
            <td class="gb-r">${sumStone > 0 ? formatMoney(sumStone) : ''}</td>
            <td class="gb-r">${sumMaking > 0 ? formatMoney(sumMaking) : ''}</td>
            <td class="gb-r">${formatMoney(sumAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="gbill-bottom">
        <div class="gbill-bottom-left">
          <table class="gbill-mini-table">${weightRows.join('')}</table>
          <p class="gbill-words"><strong>अक्षरेपी रु. <span>In words Rs.</span>:</strong> ${amountToWordsNepali(sale.total)}<br /><em>${sale.totalInWords || amountToWords(sale.total)}</em></p>
          <p class="gbill-cust-line">भुक्तानीको तरिका <span>Payment</span>: ${payBits.join(' · ') || '—'}</p>
          <p class="gbill-cust-line">कालिगढको नाम <span>Goldsmith</span>: ${escapeHtml(bill.kaligadh || '')}</p>
        </div>
        <div class="gbill-bottom-right">
          <table class="gbill-mini-table gbill-totals-table">${totalRows.join('')}</table>
        </div>
      </div>

      <div class="gbill-notes">
        <strong>नोट:</strong>
        <ul>
          <li>गहना बनाउँदा वा बिक्री गर्दा बिल अनिवार्य रूपमा लिनुहोस् / दिनुहोस्।</li>
          <li>सामान खरिद गर्दा खरिद दर भाउ अनुसारको खरिद गरिनेछ।</li>
          <li>गहना निर्माण शुल्क, निर्माण क्षति र पत्थरको रकम फिर्ता हुनेछैन।</li>
          <li>भुलचुक लिनेदिने।</li>
        </ul>
      </div>

      <div class="gbill-signs">
        <div class="gbill-sign-block">
          <div class="gbill-sign-line"></div>
          <span>ग्राहकको हस्ताक्षर <span>Customer's Signature</span></span>
        </div>
        ${sale.rateSnapshot && sale.rateSnapshot.goldRatePerTola > 0 ? `<p class="gbill-rate-note">${t('rateAtSale')}: ${formatMoney(sale.rateSnapshot.goldRatePerTola)}/tola</p>` : ''}
        <div class="gbill-sign-block">
          <div class="gbill-sign-line">${options.showSign ? `<span class="gbill-sign-name">${escapeHtml(options.signatoryName || '')}</span>` : ''}</div>
          <span>बिक्रेताको हस्ताक्षर <span>Seller's Signature</span></span>
        </div>
      </div>
      ${sale.voided ? `<p class="gbill-voided">*** ${t('voidedStamp')}${sale.voidReason ? ` — ${escapeHtml(sale.voidReason)}` : ''} ***</p>` : ''}
    </article>`;
}

function renderSaleBill(sale) {
  lastSaleBill = sale;
  const modal = document.getElementById('bill-modal');
  const content = document.getElementById('bill-content');
  if (!modal || !content) return;
  const signatory = document.getElementById('bill-signatory-name');
  if (signatory && !signatory.value) signatory.value = sale.shopName || settingsCache.shopName || '';
  content.innerHTML = buildBillHtml(sale, getBillOptions());
  modal.showModal();
}

function refreshBillPreview() {
  if (!lastSaleBill) return;
  const content = document.getElementById('bill-content');
  if (content) content.innerHTML = buildBillHtml(lastSaleBill, getBillOptions());
}

// Convert a server sale record (the authoritative, immutable invoice with the
// frozen rate snapshot and server-assigned invoice number) into the object the
// bill renderer uses.
function serverSaleToBill(sale) {
  const when = new Date(sale.createdAt);
  return {
    billNumber: sale.invoiceNumber,
    saleId: sale.id,
    date: when.toLocaleString(),
    nepaliDate: (typeof toBikramSambatString === 'function' ? toBikramSambatString(when, typeof currentLang !== 'undefined' ? currentLang : 'en') : ''),
    calendarMode: settingsCache.calendarMode || 'both',
    customer: sale.customerName,
    customerPhone: sale.customerPhone,
    customerPan: sale.customerPan,
    lines: (sale.lines || []).map((l) => ({
      itemId: l.itemId, sku: l.sku, name: l.name, category: l.category,
      karat: l.karat, weightGrams: l.weightGrams, custom: !l.inventory,
      qty: l.quantity, price: l.unitPrice,
      hsCode: l.hsCode || '', stoneAmount: Number(l.stoneAmount) || 0,
      makingCharge: Number(l.makingCharge) || 0,
      jartiRateType: l.jartiRateType || 'flat', jartiRateValue: Number(l.jartiRateValue) || 0,
      ratePerTola: Number(l.ratePerTola) || 0
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    afterDiscount: sale.afterDiscount,
    skillFeeAmount: Number(sale.skillFeeAmount) || 0,
    bill: sale.bill || null,
    taxType: sale.taxType,
    taxValue: sale.taxValue,
    taxAmount: sale.taxAmount,
    taxLabel: sale.taxType === 'percent' && sale.taxValue > 0
      ? `${shopTaxName()} (${sale.taxValue}%)`
      : shopTaxName(),
    oldGoldCredit: sale.oldGoldCredit || 0,
    oldGold: sale.oldGold || null,
    schemeCredit: sale.schemeCredit || 0,
    schemeNumber: sale.schemeNumber || null,
    total: sale.total,
    totalInWords: amountToWords(sale.total),
    paymentMethod: sale.payment?.method,
    amountReceived: sale.payment?.received,
    changeDue: sale.payment?.change,
    balanceDue: sale.payment?.due,
    rateSnapshot: sale.rateSnapshot || null,
    voided: sale.status === 'voided',
    voidReason: sale.voidReason || null,
    shopName: settingsCache.shopName,
    shopAddress: settingsCache.shopAddress,
    shopPhone: settingsCache.shopPhone,
    shopPan: settingsCache.shopPan
  };
}

async function checkoutSale() {
  try { await requireSignedIn(); } catch (err) { toast(err.message); return; }
  if (!posCart.length) return;
  if (!ensurePosCustomerName()) return;
  const customer = getSaleCustomerName();
  const customerPhone = getSaleCustomerPhone();
  const customerPan = getSaleCustomerPan();
  const totals = getSaleTotals();
  const payment = getSalePayment();

  // Single atomic checkout call. The server prices inventory lines from the
  // live/manual rate, freezes the rate + FX snapshot onto the invoice,
  // assigns the sequential invoice number, and deducts stock — all or nothing.
  const body = {
    customerName: customer,
    customerPhone,
    customerPan,
    lines: posCart.map((line) => (isNonInventoryCartLine(line)
      ? {
        custom: true, name: line.name, quantity: line.qty, unitPrice: line.price,
        sku: line.sku, category: line.category || 'gold', karat: line.karat || 0,
        weightGrams: line.weightGrams || 0, customRatePerTola: line.customRatePerTola || 0,
        notes: line.notes || '', fromOrder: line.fromOrder || null, orderNumber: line.orderNumber || null,
        hsCode: line.hsCode || '', stoneAmount: line.stoneAmount || 0,
        makingCharge: line.makingCharge || 0, jartiRateType: line.jartiRateType || null, jartiRateValue: line.jartiRateValue || 0
      }
      : { itemId: line.itemId, quantity: line.qty, hsCode: line.hsCode || undefined, stoneAmount: line.stoneAmount || undefined })),
    discount: totals.discount,
    taxType: totals.taxType,
    taxValue: totals.taxType === 'percent' ? totals.taxValue : totals.taxAmount,
    skillFee: totals.skillFeeEnabled,
    oldGold: posOldGold && getPosOldGoldCredit() > 0 ? { ...posOldGold } : null,
    schemeId: posSchemeId || null,
    payment: { method: payment.method, received: (payment.method === 'cash' || payment.method === 'credit') ? payment.received : undefined },
    bill: getBillExtras()
  };

  const sale = await api('/api/sales', { method: 'POST', body: JSON.stringify(body) });

  posCart = [];
  posOldGold = null;
  posSchemeId = '';
  if (typeof resetPosOldGoldUi === 'function') resetPosOldGoldUi();
  resetSaleTaxAndDiscount();
  resetSalePayment();
  resetBillExtras();
  resetPosCustomer();
  renderCart();
  renderSaleBill(serverSaleToBill(sale));
  await upsertCustomerActivity({ name: customer, phone: customerPhone });
  if (typeof loadSchemes === 'function' && sale.schemeId) loadSchemes().catch(() => {});
  scheduleRefresh();
}

async function refreshAll() {
  if (typeof getAuthAccessToken === 'function' && !(await getAuthAccessToken())) {
    // Only bail when sign-in is actually required. In local-dev mode
    // (no Supabase auth configured) there is no token — and that's fine.
    if (typeof isAuthRequired !== 'function' || isAuthRequired()) return;
  }
  applyStaticI18n();
  showView(activeView);
  await loadSettings();
  refreshCurrencyLabels();
  await loadPOS();
  await loadInventory();
  await loadOrders();
  await loadReports();
  await loadCustomers();
  if (typeof loadKarigars === 'function') loadKarigars().catch(() => {});
  loadExpenses();
  initGoldCalculator();
  updateGoldCalculator();
  updateTaxInputUi();
  renderCart();
}

function populateOrderItemSelect() {
  const select = document.getElementById('order-item-select');
  const submitBtn = document.getElementById('order-submit-btn');
  if (!select) return;
  select.innerHTML = orderItemsCache.length
    ? orderItemsCache.map((i) => {
      const price = formatMoney(getItemDisplayPrice(i));
      const metal = categoryLabel(i.category || 'gold');
      return `<option value="${escapeHtml(i.id)}">${escapeHtml(metal)} · ${escapeHtml(i.sku)} — ${escapeHtml(i.name)} · ${price} (${escapeHtml(i.quantity)} ${t('inStockCount')})</option>`;
    }).join('')
    : `<option value="">${t('noStock')}</option>`;
  select.disabled = !orderItemsCache.length;
  if (submitBtn) submitBtn.disabled = false;
  updateOrderTotalPreview();
}

function renderOrderCustomerSuggestions() {
  const input = document.getElementById('order-customer-search');
  const box = document.getElementById('order-customer-suggestions');
  const form = document.getElementById('order-form');
  if (!input || !box || !form) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const matches = customersCache.filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    const name = input.value.trim();
    if (name) {
      form.customerName.value = name;
      form.customerPhone.value = '';
      renderOrderCustomerDisplay({ name, phone: '', email: '' });
    } else {
      form.customerName.value = '';
      form.customerPhone.value = '';
      renderOrderCustomerDisplay(null);
    }
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-order-customer-pick="${escapeHtml(c.id)}">
      ${escapeHtml(c.name)}
      <span class="suggestion-meta">${escapeHtml(c.phone || c.email || '')}</span>
    </button>`).join('');
}

function renderOrderCustomerDisplay(customer) {
  const box = document.getElementById('order-customer-display');
  const nameEl = document.getElementById('order-customer-display-name');
  const phoneEl = document.getElementById('order-customer-display-phone');
  const emailEl = document.getElementById('order-customer-display-email');
  const name = String(customer?.name || '').trim();
  if (!box) return;
  if (!name) {
    box.hidden = true;
    if (nameEl) nameEl.textContent = '';
    if (phoneEl) phoneEl.textContent = '—';
    if (emailEl) emailEl.textContent = '—';
    return;
  }
  box.hidden = false;
  if (nameEl) nameEl.textContent = name;
  if (phoneEl) phoneEl.textContent = String(customer?.phone || '').trim() || '—';
  if (emailEl) emailEl.textContent = String(customer?.email || '').trim() || '—';
}

function clearOrderCustomer() {
  const form = document.getElementById('order-form');
  if (form) {
    form.customerName.value = '';
    form.customerPhone.value = '';
  }
  const search = document.getElementById('order-customer-search');
  if (search) search.value = '';
  const box = document.getElementById('order-customer-suggestions');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderOrderCustomerDisplay(null);
}

function fillOrderCustomerFields(customer) {
  const form = document.getElementById('order-form');
  const search = document.getElementById('order-customer-search');
  const box = document.getElementById('order-customer-suggestions');
  if (!form) return;
  form.customerName.value = customer.name || '';
  form.customerPhone.value = customer.phone || '';
  if (search) search.value = '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderOrderCustomerDisplay(customer);
}

async function openOrderModal({ context = 'order' } = {}) {
  const form = document.getElementById('order-form');
  const modal = document.getElementById('order-modal');
  if (!form || !modal) return;
  orderModalContext = context;
  form.reset();
  form.quantity.value = 1;
  if (form.customMakingCharge) form.customMakingCharge.value = 0;
  if (form.customKarat) form.customKarat.value = '24';
  if (form.customCategory) form.customCategory.value = 'gold';
  if (form.customJartiRateType) form.customJartiRateType.value = 'grams';
  if (form.customJartiRateValue) form.customJartiRateValue.value = '0';
  if (form.customJartiGrams) form.customJartiGrams.value = '';
  if (form.customJartiTola) form.customJartiTola.value = '';
  if (form.customJartiAana) form.customJartiAana.value = '';
  if (form.customJartiLaal) form.customJartiLaal.value = '';
  syncOrderJartiPanels(form, { clearInactive: true });
  updateOrderJartiPreview(form);
  if (form.advanceAmount) form.advanceAmount.value = '';
  if (form.customerGoldGrams) form.customerGoldGrams.value = '';
  if (form.goldAddedGrams) form.goldAddedGrams.value = '';
  if (form.remainingPayment) {
    form.remainingPayment.value = '';
    form.remainingPayment.dataset.manual = '0';
  }
  if (form.advancePaid) form.advancePaid.checked = false;
  renderCategorySelect(form.customCategory, { defaultValue: 'gold' });
  syncWeightEntryPanels(form, 'custom');
  setOrderItemMode(form, 'custom');
  syncItemMetalFields(form, METAL_FIELD_PRESETS.order);
  clearOrderCustomer();
  updateOrderModalChrome();

  if (context === 'pos' && selectedCustomer?.name) {
    fillOrderCustomerFields(selectedCustomer);
  }

  try {
    const payload = await api('/api/items?status=in_stock');
    orderItemsCache = payload.items.filter((i) => i.quantity > 0);
    applyMetalRatesFromResponse(payload);
  } catch (_) { /* ignore */ }
  populateOrderItemSelect();
  updateOrderTotalPreview();
  modal.showModal();
}

function openCustomerModal() {
  document.getElementById('customer-form').reset();
  document.getElementById('customer-modal').showModal();
}

function initDateDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const start = monthAgo.toISOString().slice(0, 10);
  ['report-start', 'expense-start'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = start;
  });
  ['report-end', 'expense-end'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
  const expenseDate = document.querySelector('#expense-form [name="date"]');
  if (expenseDate && !expenseDate.value) expenseDate.value = today;
}

function changeLanguage(lang) {
  setLanguage(lang);
  updateThemeToggleUI();
  if (typeof applyPhoneRegionUI === 'function') {
    applyPhoneRegionUI(
      document.getElementById('customer-phone-region'),
      document.getElementById('customer-phone-input'),
      document.getElementById('customer-phone-hint'),
      'customer'
    );
  }
  refreshAll().then(() => toast(t('languageSaved'))).catch((err) => toast(err.message));
}

document.querySelectorAll('.nav-btn, .settings-nav-btn, .rate-edit').forEach((btn) => {
  btn.addEventListener('click', () => { if (btn.dataset.view) showView(btn.dataset.view); });
});

document.getElementById('add-item-btn')?.addEventListener('click', () => openItemModal(null));
document.getElementById('refresh-inventory')?.addEventListener('click', () => loadInventory().catch((e) => toast(e.message)));
document.getElementById('add-order-btn')?.addEventListener('click', () => openOrderModal().catch(() => {}));
document.getElementById('refresh-orders')?.addEventListener('click', () => loadOrders().catch((e) => toast(e.message)));
document.getElementById('order-add-customer')?.addEventListener('click', openCustomerModal);
document.getElementById('clear-order-customer-btn')?.addEventListener('click', clearOrderCustomer);
document.getElementById('order-customer-search')?.addEventListener('input', renderOrderCustomerSuggestions);
document.getElementById('order-customer-search')?.addEventListener('focus', renderOrderCustomerSuggestions);
document.getElementById('order-customer-suggestions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-order-customer-pick]');
  if (!btn) return;
  const customer = customersCache.find((c) => c.id === btn.dataset.orderCustomerPick);
  if (customer) fillOrderCustomerFields(customer);
});
document.getElementById('order-form')?.addEventListener('click', (e) => {
  const modeBtn = e.target.closest('[data-order-item-mode]');
  if (modeBtn) {
    e.preventDefault();
    setOrderItemMode(modeBtn.closest('form'), modeBtn.dataset.orderItemMode);
  }
});
document.getElementById('order-form')?.addEventListener('input', (e) => {
  if (['itemId', 'quantity', 'customItemName', 'customKarat', 'customMakingCharge', 'customWeightUnit', 'customCategory', 'customRatePerTola', 'customJartiRateType', 'customJartiRateValue', 'customJartiGrams', 'customJartiTola', 'customJartiAana', 'customJartiLaal'].includes(e.target.name)
    || e.target.closest('#order-custom-fields .weight-entry')
    || e.target.closest('#order-jarti-fields')) {
    if (e.target.name === 'customCategory') {
      syncItemMetalFields(e.target.form, METAL_FIELD_PRESETS.order);
    }
    updateOrderTotalPreview();
  }
  if (e.target.name === 'advanceAmount') {
    updateOrderRemainingPreview(true);
  }
  if (e.target.name === 'remainingPayment') {
    e.target.dataset.manual = '1';
  }
});
document.getElementById('order-form')?.addEventListener('weight-updated', () => {
  updateOrderTotalPreview();
});
document.getElementById('order-form')?.addEventListener('change', (e) => {
  if (e.target.name === 'customJartiRateType' || e.target.name === 'customWeightUnit') {
    syncOrderJartiPanels(e.target.form, { clearInactive: true });
    updateOrderTotalPreview();
  }
  if (e.target.name === 'itemId' || e.target.name === 'customWeightUnit' || e.target.name === 'customCategory') {
    if (e.target.name === 'customCategory') {
      syncItemMetalFields(e.target.form, METAL_FIELD_PRESETS.order);
    }
    updateOrderTotalPreview();
  }
});
document.getElementById('refresh-reports')?.addEventListener('click', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('export-report-btn')?.addEventListener('click', exportReportSummary);
document.getElementById('report-start')?.addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('report-end')?.addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('refresh-customers')?.addEventListener('click', loadCustomers);
document.getElementById('add-customer-page-btn')?.addEventListener('click', openCustomerModal);
document.getElementById('add-customer-btn')?.addEventListener('click', openCustomerModal);
document.getElementById('clear-pos-customer-btn')?.addEventListener('click', resetPosCustomer);
document.getElementById('add-custom-item')?.addEventListener('click', openCustomItemModal);
document.getElementById('close-custom-item-modal')?.addEventListener('click', () => document.getElementById('custom-item-modal')?.close());
document.getElementById('cancel-custom-item-modal')?.addEventListener('click', () => document.getElementById('custom-item-modal')?.close());
document.getElementById('custom-item-add-customer')?.addEventListener('click', openCustomerModal);
document.getElementById('custom-item-customer-search')?.addEventListener('input', renderCustomItemCustomerSuggestions);
document.getElementById('custom-item-customer-search')?.addEventListener('focus', renderCustomItemCustomerSuggestions);
document.getElementById('custom-item-customer-suggestions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-custom-item-customer-pick]');
  if (!btn) return;
  const customer = customersCache.find((c) => c.id === btn.dataset.customItemCustomerPick);
  if (customer) fillCustomItemCustomerFields(customer);
});
document.getElementById('custom-item-form')?.addEventListener('input', (e) => {
  if (e.target.closest('.weight-entry') || ['karat', 'makingCharge', 'category', 'customRatePerTola', 'salePrice'].includes(e.target.name)) {
    if (e.target.name === 'category') syncItemMetalFields(e.target.form, METAL_FIELD_PRESETS.customItem);
    updateCustomItemPricePreview();
  }
  if (e.target.name === 'customerName') {
    const search = document.getElementById('custom-item-customer-search');
    if (search) search.value = e.target.value;
  }
});
document.getElementById('custom-item-form')?.addEventListener('weight-updated', () => {
  updateCustomItemPricePreview();
});
document.getElementById('custom-item-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const form = e.target;
  if (!hasWeightFromForm(form, '')) {
    toast(t('weightRequired'));
    return;
  }
  const weightGrams = getWeightGramsFromForm(form, '');
  const weightUnit = getWeightUnit(form, '');
  const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, '') : null;
  const category = fd.get('category') || 'gold';
  const itemName = resolveCustomItemName(category, fd.get('name'));
  if (!validateCustomItemName(category, itemName)) return;
  if (!validateOtherMetalRate(category, fd.get('customRatePerTola'))) return;
  addCustomItemToCart({
    customerName: fd.get('customerName'),
    customerPhone: fd.get('customerPhone'),
    category,
    name: itemName,
    karat: fd.get('karat'),
    customRatePerTola: fd.get('customRatePerTola'),
    weightGrams,
    weightUnit,
    tolaParts,
    makingCharge: fd.get('makingCharge'),
    purchaseCost: fd.get('purchaseCost'),
    quantity: fd.get('quantity'),
    location: fd.get('location'),
    notes: fd.get('notes'),
    salePrice: fd.get('salePrice'),
    hsCode: fd.get('hsCode'),
    stoneAmount: fd.get('stoneAmount')
  });
  document.getElementById('custom-item-modal')?.close();
});
document.getElementById('refresh-expenses')?.addEventListener('click', loadExpenses);

document.getElementById('close-order-modal')?.addEventListener('click', () => document.getElementById('order-modal').close());
document.getElementById('cancel-order-modal')?.addEventListener('click', () => document.getElementById('order-modal').close());
document.getElementById('close-customer-modal')?.addEventListener('click', () => document.getElementById('customer-modal').close());
document.getElementById('cancel-customer-modal')?.addEventListener('click', () => document.getElementById('customer-modal').close());
document.getElementById('close-modal')?.addEventListener('click', () => document.getElementById('item-modal').close());
document.getElementById('cancel-modal')?.addEventListener('click', () => document.getElementById('item-modal').close());
document.getElementById('item-modal')?.addEventListener('close', () => { editingId = null; });
document.getElementById('item-form')?.addEventListener('input', (e) => {
  if (['karat', 'makingCharge', 'salePrice', 'weightUnit', 'category', 'customRatePerTola'].includes(e.target.name)
    || e.target.closest('#item-form .weight-entry')) {
    if (e.target.name === 'category') syncItemMetalFields(e.target.form, METAL_FIELD_PRESETS.inventory);
    updateItemPricePreview();
  }
});
document.getElementById('item-form')?.addEventListener('weight-updated', updateItemPricePreview);
document.getElementById('item-form')?.addEventListener('change', (e) => {
  if (e.target.name === 'weightUnit' || e.target.name === 'category') {
    if (e.target.name === 'category') syncItemMetalFields(e.target.form, METAL_FIELD_PRESETS.inventory);
    updateItemPricePreview();
  }
  if (e.target.name === 'status') {
    const form = e.target.form;
    const qtyEl = form?.elements?.quantity;
    if (!qtyEl) return;
    if (e.target.value === 'sold_out') qtyEl.value = 0;
  }
});

document.getElementById('item-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const body = itemPayloadFromForm(form, fd);
  if (itemMetalType(body.category) === 'other' && !validateOtherMetalRate(body.category, body.customRatePerTola)) {
    return;
  }
  if (!body.name) {
    toast(itemMetalType(body.category) === 'other' ? t('itemNameOtherRequired') : t('customItemNameRequired'));
    return;
  }
  if (body.weightGrams <= 0) {
    toast(t('weightRequired'));
    return;
  }
  try {
    if (editingId) {
      await api(`/api/items/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast(t('itemUpdated'));
    } else {
      await api('/api/items', { method: 'POST', body: JSON.stringify(body) });
      toast(t('itemAdded'));
    }
    document.getElementById('item-modal').close();
  } catch (err) { toast(err.message); }
});

document.getElementById('inventory-table')?.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit]');
  const deleteBtn = e.target.closest('[data-delete]');
  if (editBtn?.dataset.edit) {
    const item = itemsCache.find((i) => i.id === editBtn.dataset.edit);
    if (item) openItemModal(item);
    return;
  }
  if (deleteBtn?.dataset.delete && confirm(t('deleteConfirm'))) {
    try {
      await api(`/api/items/${deleteBtn.dataset.delete}`, { method: 'DELETE' });
      toast(t('itemDeleted'));
    } catch (err) { toast(err.message); }
  }
});

// Search boxes: debounced, and a failed fetch is shown rather than lost.
function debounced(fn, ms = 200) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => { fn().catch((err) => toast(err.message)); }, ms);
  };
}
document.getElementById('search-items')?.addEventListener('input', debounced(() => loadInventory()));
document.getElementById('search-orders')?.addEventListener('input', applyOrdersSearch);
document.getElementById('order-group-tabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-order-group]');
  if (!tab) return;
  setOrderGroup(tab.dataset.orderGroup);
});
document.getElementById('search-customers')?.addEventListener('input', loadCustomers);
document.getElementById('filter-customers')?.addEventListener('input', loadCustomers);
document.getElementById('filter-expenses')?.addEventListener('input', loadExpenses);
document.getElementById('expense-start')?.addEventListener('change', loadExpenses);
document.getElementById('expense-end')?.addEventListener('change', loadExpenses);

document.querySelectorAll('.report-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    reportTab = tab.dataset.tab;
    document.querySelectorAll('.report-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    if (reportCache) {
      updateReportSectionTitle();
      const { start, end } = reportDateRange();
      const expenses = expensesInRange(start, end);
      const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const netProfit = reportCache.sales.revenue - expenseTotal;
      if (reportTab === 'inventory') renderInventoryReport(reportCache);
      else if (reportTab === 'customer') renderCustomerReport(reportCache);
      else if (reportTab === 'invoices') {
        if (typeof renderInvoicesReport === 'function') renderInvoicesReport();
      } else if (reportTab === 'karigar' || reportTab === 'goldledger') {
        if (typeof renderKarigarReport === 'function') renderKarigarReport(reportTab);
      } else renderSalesReport(reportCache, expenseTotal, netProfit);
      return;
    }
    loadReports().catch((e) => toast(e.message));
  });
});
document.getElementById('pos-customer-search')?.addEventListener('input', () => {
  renderCustomerSuggestions();
});
document.getElementById('pos-customer-search')?.addEventListener('focus', renderCustomerSuggestions);
document.getElementById('customer-suggestions')?.addEventListener('click', (e) => {
  const id = e.target.closest('[data-customer-pick]')?.dataset.customerPick;
  if (!id) return;
  const customer = customersCache.find((c) => c.id === id);
  if (customer) selectPosCustomer(customer);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-field')) {
    const box = document.getElementById('customer-suggestions');
    if (box) box.hidden = true;
  }
});
document.getElementById('pos-theme-toggle')?.addEventListener('click', toggleTheme);
document.getElementById('pos-search')?.addEventListener('input', debounced(() => loadPOS()));
document.getElementById('pos-search')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  quickAddFromSearch().catch((err) => toast(err.message));
});
document.getElementById('pos-filter-category')?.addEventListener('change', () => loadPOS().catch((err) => toast(err.message)));
document.getElementById('pos-sort')?.addEventListener('change', () => {
  renderPosCatalog();
});

document.getElementById('pos-product-grid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pos-add-cart]');
  if (!btn) return;
  const item = posItemsCache.find((i) => i.id === btn.dataset.posAddCart);
  if (item) addToCart(item);
});

document.getElementById('quick-suggestions-chips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-quick-add]');
  if (!chip) return;
  const item = posItemsCache.find((i) => i.id === chip.dataset.quickAdd);
  if (item) addToCart(item);
});

document.getElementById('cart-payment-method')?.addEventListener('change', updatePaymentUi);
document.getElementById('cart-received')?.addEventListener('input', updatePaymentUi);

document.getElementById('cart-lines')?.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-cart-remove]');
  if (removeBtn) {
    posCart.splice(Number(removeBtn.dataset.cartRemove), 1);
    renderCart();
    return;
  }
  const incBtn = e.target.closest('[data-cart-inc]');
  if (incBtn) {
    const idx = Number(incBtn.dataset.cartInc);
    const hitLimit = setCartQty(idx, (posCart[idx]?.qty || 0) + 1);
    if (hitLimit) toast(t('noStock'));
    return;
  }
  const decBtn = e.target.closest('[data-cart-dec]');
  if (decBtn) {
    const idx = Number(decBtn.dataset.cartDec);
    setCartQty(idx, (posCart[idx]?.qty || 1) - 1);
    return;
  }
});

document.getElementById('cart-lines')?.addEventListener('change', (e) => {
  const input = e.target.closest('[data-cart-qty]');
  if (!input) return;
  const idx = Number(input.dataset.cartQty);
  const hitLimit = setCartQty(idx, input.value);
  if (hitLimit) toast(t('noStock'));
});

document.getElementById('cart-discount')?.addEventListener('input', renderCart);
document.getElementById('cart-tax-type')?.addEventListener('change', () => {
  updateTaxInputUi();
  renderCart();
});
document.getElementById('cart-tax-value')?.addEventListener('input', renderCart);
document.getElementById('pos-skill-fee')?.addEventListener('change', renderCart);
document.getElementById('bill-style-select')?.addEventListener('change', refreshBillPreview);
document.getElementById('cart-tax-inc')?.addEventListener('click', () => stepTax(1));
document.getElementById('cart-tax-dec')?.addEventListener('click', () => stepTax(-1));
document.getElementById('cancel-sale')?.addEventListener('click', () => {
  posCart = [];
  posOldGold = null;
  posSchemeId = '';
  if (typeof resetPosOldGoldUi === 'function') resetPosOldGoldUi();
  resetSaleTaxAndDiscount();
  resetSalePayment();
  resetBillExtras();
  renderCart();
});
document.getElementById('checkout-btn')?.addEventListener('click', () => checkoutSale().catch((e) => toast(e.message)));
document.getElementById('close-bill-modal')?.addEventListener('click', () => document.getElementById('bill-modal')?.close());
document.getElementById('bill-done-btn')?.addEventListener('click', () => document.getElementById('bill-modal')?.close());
document.getElementById('print-bill-btn')?.addEventListener('click', () => window.print());
['bill-show-sign', 'bill-show-stamp', 'bill-show-customer-sign'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshBillPreview);
});
document.getElementById('bill-signatory-name')?.addEventListener('input', refreshBillPreview);

function resolveOrderCustomerName(form) {
  const hidden = String(form.customerName?.value || '').trim();
  if (hidden) return hidden;
  return String(document.getElementById('order-customer-search')?.value || '').trim();
}

document.getElementById('order-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const customerName = resolveOrderCustomerName(form);
  if (!customerName) {
    toast(t('customerNamePrompt'));
    return;
  }
  form.customerName.value = customerName;
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  body.customerName = customerName;
  body.quantity = Number(body.quantity) || 1;
  body.advanceAmount = body.advanceAmount === '' || body.advanceAmount == null ? '' : parseMoneyField(body.advanceAmount) || 0;
  body.advancePaid = Boolean(fd.get('advancePaid'));
  body.customerGoldGrams = body.customerGoldGrams === '' || body.customerGoldGrams == null ? '' : Number(body.customerGoldGrams) || 0;
  body.goldAddedGrams = body.goldAddedGrams === '' || body.goldAddedGrams == null ? '' : Number(body.goldAddedGrams) || 0;
  body.remainingPayment = body.remainingPayment === '' || body.remainingPayment == null ? '' : parseMoneyField(body.remainingPayment) || 0;
  const karigarSelect = form.karigarId;
  if (karigarSelect && karigarSelect.selectedOptions?.[0]) {
    const label = String(karigarSelect.selectedOptions[0].textContent || '').trim();
    body.karigarName = karigarSelect.value ? label : '';
  }

  if (orderModalContext === 'pos' || body.orderItemMode === 'custom') {
    const category = body.customCategory || 'gold';
    const itemName = resolveCustomItemName(category, body.customItemName);
    if (!validateCustomItemName(category, itemName)) return;
    if (!validateOtherMetalRate(category, body.customRatePerTola)) return;
    if (!hasWeightFromForm(form, 'custom')) {
      toast(t('weightRequired'));
      return;
    }
    const weightGrams = getWeightGramsFromForm(form, 'custom');
    if (orderModalContext === 'pos') {
      addCustomItemToCart({
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        category,
        name: itemName,
        karat: body.customKarat,
        customRatePerTola: body.customRatePerTola,
        weightGrams,
        weightUnit: getWeightUnit(form, 'custom'),
        tolaParts: getWeightUnit(form, 'custom') === 'tola' ? getTolaPartsFromForm(form, 'custom') : null,
        makingCharge: body.customMakingCharge,
        jartiRateType: body.customJartiRateType || 'percent',
        jartiRateValue: body.customJartiRateType === 'percent'
          ? body.customJartiRateValue
          : getOrderJartiGramsFromForm(form),
        jartiWeightGrams: getOrderJartiGramsFromForm(form),
        quantity: body.quantity,
        location: '',
        notes: body.note || '',
        salePrice: ''
      });
      document.getElementById('order-modal').close();
      form.reset();
      form.quantity.value = 1;
      if (form.customKarat) form.customKarat.value = '24';
      if (form.customCategory) form.customCategory.value = 'gold';
      renderCategorySelect(form.customCategory, { defaultValue: 'gold' });
      syncWeightEntryPanels(form, 'custom');
      syncItemMetalFields(form, METAL_FIELD_PRESETS.order);
      clearOrderCustomer();
      return;
    }
    body.customItem = {
      name: itemName,
      category,
      karat: Number(body.customKarat) || 24,
      customRatePerTola: parseMoneyField(body.customRatePerTola || 0),
      weightGrams,
      weightUnit: getWeightUnit(form, 'custom'),
      weightTola: Number(form.customWeightTola?.value) || 0,
      weightAana: Number(form.customWeightAana?.value) || 0,
      weightLaal: Number(form.customWeightLaal?.value) || 0,
      makingCharge: parseMoneyField(body.customMakingCharge || 0),
      jartiRateType: String(body.customJartiRateType || 'percent'),
      jartiRateValue: body.customJartiRateType === 'percent'
        ? (Number(body.customJartiRateValue) || 0)
        : getOrderJartiGramsFromForm(form),
      jartiWeightGrams: getOrderJartiGramsFromForm(form),
      jartiTola: Number(form.customJartiTola?.value) || 0,
      jartiAana: Number(form.customJartiAana?.value) || 0,
      jartiLaal: Number(form.customJartiLaal?.value) || 0
    };
    delete body.itemId;
  }
  try {
    await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    toast(t('orderCreated'));
    document.getElementById('order-modal').close();
    e.target.reset();
    e.target.quantity.value = 1;
    syncWeightEntryPanels(e.target, 'custom');
    clearOrderCustomer();
    orderGroup = 'new';
    setOrderGroup('new');
    await upsertCustomerActivity({
      name: body.customerName,
      phone: body.customerPhone
    });
    scheduleRefresh();
  } catch (err) { toast(err.message); }
});

document.getElementById('customer-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const phone = String(fd.get('phone') || '').trim();
  const phoneRegion = typeof getPhoneRegionFromSelect === 'function'
    ? getPhoneRegionFromSelect('customer-phone-region')
    : 'NP';
  if (phone && typeof isValidPhoneForRegion === 'function' && !isValidPhoneForRegion(phone, phoneRegion)) {
    toast(typeof phoneInvalidMessage === 'function' ? phoneInvalidMessage(phoneRegion) : t('authInvalidPhone'));
    return;
  }
  try {
    const payload = await api('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        phone: fd.get('phone'),
        phoneRegion,
        email: fd.get('email') || '',
        address: fd.get('address') || ''
      })
    });
    customersCache = payload.customers || customersCache;
    const customer = payload.customer || customersCache[0];
    document.getElementById('customer-modal').close();
    toast(t('customerSaved'));
    renderCustomersTable();
    if (customer) {
      selectPosCustomer(customer);
      if (document.getElementById('order-modal')?.open) {
        fillOrderCustomerFields(customer);
      }
    }
  } catch (err) { toast(err.message); }
});

document.getElementById('expense-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const expenses = localData('subarnapasal.expenses', []);
  expenses.unshift({
    id: `e-${Date.now()}`,
    date: fd.get('date'),
    category: fd.get('category'),
    description: fd.get('description'),
    amount: parseMoneyField(fd.get('amount'))
  });
  saveLocalData('subarnapasal.expenses', expenses);
  e.target.reset();
  initDateDefaults();
  toast(t('expenseSaved'));
  scheduleRefresh();
});

document.getElementById('customers-table')?.addEventListener('click', async (e) => {
  const id = e.target.dataset.customerDelete;
  if (!id) return;
  try {
    const payload = await api(`/api/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    customersCache = payload.customers || [];
    renderCustomersTable();
  } catch (err) { toast(err.message); }
});

document.getElementById('expenses-table')?.addEventListener('click', (e) => {
  const id = e.target.dataset.expenseDelete;
  if (!id) return;
  const expenses = localData('subarnapasal.expenses', []).filter((e) => e.id !== id);
  saveLocalData('subarnapasal.expenses', expenses);
  scheduleRefresh();
});

document.getElementById('orders-content')?.addEventListener('click', async (e) => {
  const cartBtn = e.target.closest('[data-order-cart]');
  if (cartBtn) {
    const order = ordersAllCache.find((o) => o.id === cartBtn.dataset.orderCart);
    if (order) addOrderToCart(order);
    return;
  }
  const actionBtn = e.target.closest('[data-order-action]');
  if (actionBtn?.dataset.orderId && actionBtn.dataset.orderAction) {
    const action = actionBtn.dataset.orderAction;
    if (actionBtn.dataset.orderRevert === 'completed' && !confirm(t('orderStatusRevertConfirm'))) return;
    if (action === 'cancelled' && !confirm(t('cancelOrderConfirm'))) return;
    try {
      await updateOrderStatus(actionBtn.dataset.orderId, action);
      const tabGroup = orderGroupIdForStatus(action);
      if (tabGroup) setOrderGroup(tabGroup);
    } catch (err) { toast(err.message); }
  }
});

document.getElementById('settings-store-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const shopName = String(fd.get('shopName') || '').trim();
  if (!shopName) {
    toast(t('shopNameRequired'));
    return;
  }
  const available = await checkShopNameAvailability(shopName);
  if (!available) {
    toast(t('shopNameTaken'));
    return;
  }
  const prevCountry = shopCountry();
  const country = SHOP_COUNTRIES[fd.get('country')] ? String(fd.get('country')) : 'NP';
  const salesTaxRaw = fd.get('salesTaxRate');
  const salesTaxRate = salesTaxRaw === '' || salesTaxRaw == null ? 0 : Number(salesTaxRaw);
  if (!Number.isFinite(salesTaxRate) || salesTaxRate < 0 || salesTaxRate > 100) {
    toast(t('salesTaxRateInvalid'));
    return;
  }
  try {
    const updated = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        shopName,
        shopAddress: fd.get('shopAddress'),
        shopPhone: fd.get('shopPhone'),
        shopPan: fd.get('shopPan'),
        vatRate: fd.get('vatRate') === '' || fd.get('vatRate') == null ? 13 : Number(fd.get('vatRate')),
        country,
        salesTaxRate,
        // The Nepali (BS) date only belongs on a Nepal bill.
        calendarMode: country === 'NP' ? (fd.get('calendarMode') || 'both') : 'ad'
      })
    });
    settingsCache.shopName = updated.shopName || shopName;
    settingsCache.shopAddress = String(updated.shopAddress || fd.get('shopAddress') || '').trim();
    settingsCache.shopPhone = String(updated.shopPhone || fd.get('shopPhone') || '').trim();
    settingsCache.shopPan = String(updated.shopPan != null ? updated.shopPan : (fd.get('shopPan') || '')).trim();
    settingsCache.vatRate = updated.vatRate != null ? Number(updated.vatRate) : (Number(fd.get('vatRate')) || 13);
    settingsCache.country = SHOP_COUNTRIES[updated.country] ? updated.country : country;
    rememberShopCountry(settingsCache.country);
    settingsCache.salesTaxRate = updated.salesTaxRate != null ? Number(updated.salesTaxRate) : salesTaxRate;
    settingsCache.calendarMode = updated.calendarMode
      || (country === 'NP' ? (fd.get('calendarMode') || 'both') : 'ad');
    applyShopCountryUi();
    // Moving the shop to another country switches the display currency to match.
    // It stays overridable from the Display currency dropdown afterwards.
    if (settingsCache.country !== prevCountry) {
      await switchCurrencyForCountry(settingsCache.country);
    }
    resetSaleTaxAndDiscount();
    renderCart();
    updateShopBranding();
    const signatory = document.getElementById('bill-signatory-name');
    if (signatory && (!signatory.value || signatory.value === 'Suvarnapasal' || signatory.value === 'SubarnaPasal')) {
      signatory.value = settingsCache.shopName;
    }
    renderShopNameStatus({ unchanged: true });
    toast(t('settingsSaved'));
  } catch (err) { toast(err.message); }
});

// Preview the location's fields immediately; nothing takes effect at the till
// until "Save Store Info" is pressed.
document.getElementById('settings-country')?.addEventListener('change', (e) => {
  applyCountryFormFields(SHOP_COUNTRIES[e.target.value] ? e.target.value : 'NP');
});

document.getElementById('settings-shop-name')?.addEventListener('input', (e) => {
  scheduleShopNameCheck(e.target.value);
});

document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const goldRatePerTola = parseTolaRateInput(fd.get('goldRatePerTola'))
      || parseTolaFromGramInput(fd.get('goldRatePerGram'));
    const goldBuyRatePerTola = parseTolaRateInput(fd.get('goldBuyRatePerTola'))
      || parseTolaFromGramInput(fd.get('goldBuyRatePerGram') || 0);
    const silverRatePerTola = parseTolaRateInput(fd.get('silverRatePerTola'))
      || parseTolaFromGramInput(fd.get('silverRatePerGram') || 0);
    const priceMode = PRICE_MODE;
    const fxRates = {};
    const fxUsd = Number(fd.get('fxUsd'));
    const fxCad = Number(fd.get('fxCad'));
    if (fxUsd > 0) fxRates.USD = fxUsd;
    if (fxCad > 0) fxRates.CAD = fxCad;
    const saved = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        goldRatePerTola, goldBuyRatePerTola, silverRatePerTola, priceMode,
        ...(Object.keys(fxRates).length ? { fxRates } : {})
      })
    });
    if (saved.fxRates) {
      settingsCache.fxRates = saved.fxRates;
      settingsCache.fxUpdatedAt = saved.fxUpdatedAt || settingsCache.fxUpdatedAt;
      if (saved.fxRates.USD > 0) CURRENCIES.USD.nprPerUnit = Number(saved.fxRates.USD);
      if (saved.fxRates.CAD > 0) CURRENCIES.CAD.nprPerUnit = Number(saved.fxRates.CAD);
    }
    if (Array.isArray(saved.rateHistory)) {
      rateHistoryCache = saved.rateHistory;
      renderRateHistoryChart();
      renderRateHistoryTable();
    }
    settingsPriceMode = PRICE_MODE;
    settingsCache.priceMode = settingsPriceMode;
    settingsCache.goldRatePerTola = goldRatePerTola;
    settingsCache.goldBuyRatePerTola = goldBuyRatePerTola;
    settingsCache.silverRatePerTola = silverRatePerTola;
    goldRateCache = goldRatePerTola;
    goldBuyRateCache = goldBuyRatePerTola;
    silverRateCache = silverRatePerTola;
    await updateMetalRates(resolveManualMetalRates({
      goldRatePerTola,
      goldRatePerGram: Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
      silverRatePerTola,
      silverRatePerGram: Number((silverRatePerTola / TOLA_GRAMS).toFixed(2))
    }));
    syncMetalRatePolling();
    refreshDisplayPrices();
    toast(t('settingsSaved'));
  } catch (err) { toast(err.message); }
});

document.querySelector('#settings-form [name="goldRatePerGram"]')?.addEventListener('input', syncSettingsGoldRateFromGram);
document.querySelector('#settings-form [name="goldRatePerTola"]')?.addEventListener('input', syncSettingsGoldRateFromTola);
document.querySelector('#settings-form [name="goldBuyRatePerGram"]')?.addEventListener('input', syncSettingsGoldBuyRateFromGram);
document.querySelector('#settings-form [name="goldBuyRatePerTola"]')?.addEventListener('input', syncSettingsGoldBuyRateFromTola);
document.querySelector('#settings-form [name="silverRatePerGram"]')?.addEventListener('input', syncSettingsSilverRateFromGram);
document.querySelector('#settings-form [name="silverRatePerTola"]')?.addEventListener('input', syncSettingsSilverRateFromTola);
document.getElementById('clear-rate-history-btn')?.addEventListener('click', clearRateHistoryForCurrentMode);
// ── Market gold price ───────────────────────────────────────────────────
// The international price, fetched by the SERVER from the metal API every 15
// minutes and kept in full in gold_price_ticks. This page only reads
// /api/gold-price; it never talks to the metal API itself, so every shop and
// every phone draws the same chart from the same rows. Reference only — the
// shop's selling rate (settings-form above) is what prices items.
const MARKET_PRICE_REFRESH_MS = 5 * 60 * 1000;
let marketPriceRange = '24h';
let marketPriceData = null;
let marketPriceTimer = null;
let marketPriceLoading = false;

function currentMarketRange() {
  const active = document.querySelector('.market-price-range [data-market-range].is-active');
  return active?.dataset.marketRange || marketPriceRange;
}

function marketRangeLabel(range) {
  const keys = { '24h': 'marketRange24h', week: 'marketRangeWeek', month: 'marketRangeMonth', '6m': 'marketRange6m' };
  return t(keys[range] || 'marketRange24h');
}

function formatMarketWhen(iso, range) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === 'week') return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  if (range === 'month') return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMarketWhenFull(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? (iso || '') : d.toLocaleString();
}

async function loadMarketGoldPrice(range = currentMarketRange()) {
  const chartEl = document.getElementById('market-price-chart');
  if (!chartEl || marketPriceLoading) return;
  marketPriceLoading = true;
  marketPriceRange = range;
  try {
    // Plain fetch, not api(): this endpoint is public and must not redirect
    // to login or trigger the mutation refresh.
    const headers = {};
    if (typeof getAuthAccessToken === 'function') {
      const token = await getAuthAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`/api/gold-price?range=${encodeURIComponent(range)}`, { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      marketPriceData = null;
      chartEl.innerHTML = `<p class="empty market-price-empty">${escapeHtml(data.error || t('marketPriceUnavailable'))}</p>`;
      renderMarketPriceTable(null);
      return;
    }
    marketPriceData = data;
    renderMarketGoldPrice();
  } catch (err) {
    chartEl.innerHTML = `<p class="empty market-price-empty">${t('marketPriceUnavailable')}</p>`;
  } finally {
    marketPriceLoading = false;
  }
}

function renderMarketGoldPrice() {
  const el = document.getElementById('market-price-chart');
  if (!el) return;
  const data = marketPriceData;
  if (!data || !Array.isArray(data.points) || !data.points.length) {
    el.innerHTML = `<p class="empty market-price-empty">${t('marketPriceEmpty')}</p>`;
    renderMarketPriceTable(null);
    return;
  }
  const points = data.points;
  const range = data.range || marketPriceRange;
  const latest = data.latest || points[points.length - 1];
  const change = Number(data.change) || 0;
  const pct = Number(data.changePercent) || 0;
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '+' : '';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';

  const header = `
    <div class="goldprice-chart-header">
      <div class="goldprice-header-main">
        <div class="goldprice-brand">
          <span class="goldprice-icon" aria-hidden="true">●</span>
          <div>
            <h4 class="goldprice-title">${t('marketGoldPrice')}</h4>
            <span class="goldprice-sub">${marketRangeLabel(range)} · ${escapeHtml(latest.source || 'gold-api.com')}</span>
          </div>
        </div>
        <div class="goldprice-quote is-${dir}">
          <span class="goldprice-value">${formatCurrencyAmount(latest.goldPerTola)}</span>
          <span class="goldprice-unit">/ ${t('tolaUnit')}</span>
          <span class="goldprice-change">
            <span class="goldprice-arrow" aria-hidden="true">${arrow}</span>
            ${sign}${formatCurrencyAmount(change)}
            <span class="goldprice-pct">(${sign}${pct}%)</span>
          </span>
        </div>
      </div>
      <div class="goldprice-stats">
        <span class="goldprice-stat"><em>${t('marketPricePerGram')}</em> ${formatCurrencyAmount(latest.goldPerGram)}</span>
        <span class="goldprice-stat"><em>${t('chartHigh')}</em> ${formatCurrencyAmount(data.high)}</span>
        <span class="goldprice-stat"><em>${t('chartLow')}</em> ${formatCurrencyAmount(data.low)}</span>
        <span class="goldprice-stat"><em>${t('marketPriceUsdOz')}</em> ${Number(latest.goldUsdPerOz || 0).toFixed(2)}</span>
        <span class="goldprice-stat"><em>${t('marketPriceUpdated')}</em> ${escapeHtml(formatMarketWhenFull(latest.capturedAt))}</span>
      </div>
    </div>`;

  // Time-based x axis: a gap in the data (server down for a night) shows as
  // a gap, not as two neighbouring points.
  const W = 760, H = 280;
  const pad = { t: 18, r: 70, b: 34, l: 12 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const times = points.map((p) => new Date(p.capturedAt).getTime());
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const tSpan = Math.max(1, t1 - t0);
  const values = points.map((p) => Number(p.goldPerTola) || 0);
  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  const span0 = maxV - minV;
  const padV = span0 > 0 ? span0 * 0.12 : Math.max(1, maxV * 0.005);
  minV -= padV; maxV += padV;
  const vSpan = maxV - minV;
  const px = (i) => pad.l + (points.length === 1 ? innerW / 2 : ((times[i] - t0) / tSpan) * innerW);
  const py = (v) => pad.t + innerH - ((v - minV) / vSpan) * innerH;
  const xy = points.map((p, i) => ({ x: px(i), y: py(values[i]) }));
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = (pad.t + innerH).toFixed(1);
  const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${base} L${xy[0].x.toFixed(1)},${base} Z`;
  const gridRows = [...Array(4)].map((_, i) => {
    const v = minV + (vSpan * i) / 3;
    const y = py(v);
    return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + innerW}" y2="${y.toFixed(1)}" class="gtrend-grid" />
      <text x="${pad.l + innerW + 8}" y="${(y + 4).toFixed(1)}" class="gtrend-ylabel">${formatGoldTrendYLabel(v)}</text>`;
  }).join('');
  const labelCount = Math.min(6, points.length);
  const labelIdx = new Set([...Array(labelCount)].map((_, i) => Math.round((i * (points.length - 1)) / Math.max(1, labelCount - 1))));
  const xLabels = points.map((p, i) => {
    if (!labelIdx.has(i)) return '';
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    return `<text x="${px(i).toFixed(1)}" y="${H - 10}" text-anchor="${anchor}" class="gtrend-xlabel">${escapeHtml(formatMarketWhen(p.capturedAt, range))}</text>`;
  }).join('');
  const last = xy[xy.length - 1];

  el.innerHTML = `${header}
    <div class="gtrend-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="gtrend-svg" preserveAspectRatio="none" role="img" aria-label="${t('marketGoldPrice')}">
        <defs>
          <linearGradient id="market-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--gold, #b45309)" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="var(--gold, #b45309)" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${gridRows}
        <path d="${area}" fill="url(#market-fill)"/>
        <path d="${line}" fill="none" stroke="var(--gold, #b45309)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line id="market-cross" x1="0" y1="${pad.t}" x2="0" y2="${pad.t + innerH}" class="gtrend-cross" hidden/>
        <circle id="market-hoverdot" r="4.5" class="gtrend-hoverdot" hidden/>
        <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5" class="gtrend-lastdot"/>
        ${xLabels}
      </svg>
      <div id="market-tip" class="gtrend-tip" hidden></div>
    </div>`;

  // Hover: nearest reading by x, crosshair + exact figure.
  const svg = el.querySelector('svg');
  const cross = el.querySelector('#market-cross');
  const dot = el.querySelector('#market-hoverdot');
  const tip = el.querySelector('#market-tip');
  const wrap = el.querySelector('.gtrend-wrap');
  if (svg && cross && dot && tip && wrap) {
    const onMove = (evt) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((evt.clientX - rect.left) / rect.width) * W;
      let best = 0;
      let bestD = Infinity;
      xy.forEach((p, i) => { const d = Math.abs(p.x - relX); if (d < bestD) { bestD = d; best = i; } });
      const p = xy[best];
      const row = points[best];
      const prev = best > 0 ? values[best - 1] : values[best];
      const delta = values[best] - prev;
      cross.setAttribute('x1', p.x.toFixed(1)); cross.setAttribute('x2', p.x.toFixed(1)); cross.hidden = false;
      dot.setAttribute('cx', p.x.toFixed(1)); dot.setAttribute('cy', p.y.toFixed(1)); dot.hidden = false;
      tip.innerHTML = `<strong>${formatCurrencyAmount(values[best])}</strong> / ${t('tolaUnit')}<br>${escapeHtml(formatMarketWhenFull(row.capturedAt))}<br><span class="gtrend-tip-change ${delta >= 0 ? 'is-up' : 'is-down'}">${delta >= 0 ? '+' : ''}${formatCurrencyAmount(delta)}</span>`;
      tip.hidden = false;
      const leftPct = (p.x / W) * 100;
      tip.style.left = `${Math.min(80, Math.max(0, leftPct))}%`;
      tip.style.top = `${(p.y / H) * 100}%`;
    };
    const onLeave = () => { cross.hidden = true; dot.hidden = true; tip.hidden = true; };
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('touchmove', (e) => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('touchend', onLeave);
  }

  renderMarketPriceTable(data);
}

function renderMarketPriceTable(data) {
  const wrapEl = document.getElementById('market-price-table');
  const countEl = document.getElementById('market-price-history-count');
  if (!wrapEl) return;
  if (!data || !data.points?.length) {
    wrapEl.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }
  const range = data.range || marketPriceRange;
  const bucketed = Number(data.bucketSeconds) > 0;
  const rows = [...data.points].reverse();
  if (countEl) countEl.textContent = `(${rows.length} ${t('marketPriceReadings')} · ${marketRangeLabel(range)})`;
  const body = rows.map((p, i) => {
    const older = rows[i + 1];
    const delta = older ? Number(p.goldPerTola) - Number(older.goldPerTola) : 0;
    const cls = delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '';
    const sign = delta > 0 ? '+' : '';
    return `<tr>
      <td>${escapeHtml(formatMarketWhenFull(p.capturedAt))}</td>
      <td class="num"><strong>${formatCurrencyAmount(p.goldPerTola)}</strong></td>
      <td class="num">${formatCurrencyAmount(p.goldPerGram)}</td>
      <td class="num ${cls}">${older ? `${sign}${formatCurrencyAmount(delta)}` : '—'}</td>
      ${bucketed ? `<td class="num">${formatCurrencyAmount(p.low)} – ${formatCurrencyAmount(p.high)}</td>` : ''}
      <td class="num">${Number(p.goldUsdPerOz || 0).toFixed(2)}</td>
    </tr>`;
  }).join('');
  wrapEl.innerHTML = `<table class="data-table market-price-table">
    <thead><tr>
      <th>${t('marketPriceTime')}</th>
      <th class="num">${t('marketPricePerTola')}</th>
      <th class="num">${t('marketPricePerGram')}</th>
      <th class="num">${t('marketPriceChange')}</th>
      ${bucketed ? `<th class="num">${t('marketPriceLowHigh')}</th>` : ''}
      <th class="num">${t('marketPriceUsdOz')}</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function syncMarketPricePolling() {
  if (marketPriceTimer) { clearInterval(marketPriceTimer); marketPriceTimer = null; }
  if (activeView !== 'settings') return;
  loadMarketGoldPrice().catch(() => {});
  marketPriceTimer = setInterval(() => {
    if (!document.hidden) loadMarketGoldPrice().catch(() => {});
  }, MARKET_PRICE_REFRESH_MS);
}

document.querySelectorAll('.market-price-range [data-market-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.market-price-range [data-market-range]').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    loadMarketGoldPrice(btn.dataset.marketRange).catch(() => {});
  });
});
document.getElementById('market-price-refresh-btn')?.addEventListener('click', () => {
  loadMarketGoldPrice().catch(() => {});
});

document.querySelectorAll('.rate-history-period [data-rate-period]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rate-history-period [data-rate-period]').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (btn.dataset.ratePeriod === 'daily') {
      loadSharedGoldRates().then(() => {
        renderRateHistoryChart();
        renderRateHistoryTable();
      }).catch(() => {});
      syncMetalRatePolling();
    } else {
      stopMetalRatePolling();
      liveDailyCurrentTick = null;
      resetLiveDailySecondSeries();
      liveDailyFlatAnchor = null;
    }
    renderLiveDailyRateNow();
    renderRateHistoryChart();
  });
});
document.querySelectorAll('#settings-form [name="priceMode"]').forEach((radio) => {
  radio.addEventListener('change', async () => {
    settingsPriceMode = effectivePriceMode();
    stopMetalRatePolling();
    if (!isLiveDailyApiMode()) {
      liveDailyCurrentTick = null;
      resetLiveDailySecondSeries();
      liveDailyFlatAnchor = null;
    }
    const metal = resolveManualMetalRates(settingsCache);
    applyManualRatesToApp(metal);
    refreshMetalPriceFields();
    await updateMetalRates(metal);
    loadSharedGoldRates().then(() => {
      renderRateHistoryChart();
      renderRateHistoryTable();
    }).catch(() => {});
    renderLiveDailyRateNow();
    renderRateHistoryChart();
    renderRateHistoryTable();
    syncMetalRatePolling();
  });
});

document.getElementById('language-select')?.addEventListener('change', (e) => {
  changeLanguage(e.target.value);
  // Re-apply the country labels: applyStaticI18n() resets the shared tax spans.
  applyShopCountryUi();
  renderCart();
});

// The Display currency and Shop location move together in BOTH directions:
// picking NPR applies the full Nepal setup, USD → USA, CAD → Canada (tax
// style, payment methods, bill format, phone/address formats — everything).
const COUNTRY_FOR_CURRENCY = { NPR: 'NP', USD: 'US', CAD: 'CA' };

document.getElementById('currency-select')?.addEventListener('change', async (e) => {
  const prevCurrency = displayCurrency;
  setDisplayCurrency(e.target.value);
  const countryForCurrency = COUNTRY_FOR_CURRENCY[displayCurrency] || 'NP';
  const countryChanged = countryForCurrency !== shopCountry();

  // Apply the choice IMMEDIATELY and remember it on this computer. The server
  // save below is best-effort — even if the backend is old or offline, the
  // user's selection always sticks and is never reverted.
  settingsCache.currency = displayCurrency;
  settingsCache.country = countryForCurrency;
  rememberDisplayCurrency(displayCurrency);
  rememberShopCountry(countryForCurrency);
  if (countryChanged) {
    applyShopCountryUi();
    // Don't disturb a sale in progress — only re-seed the tax box when the
    // cart is empty (Nepal → 0, USA/Canada → the configured sales-tax %).
    if (!posCart.length) resetSaleTaxAndDiscount();
    renderCart();
  }
  api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ currency: displayCurrency, country: countryForCurrency })
  }).catch(() => { /* keep the local choice; it re-saves on next launch */ });
  await refreshAfterCurrencyChange(prevCurrency).catch(() => {});
});

setItemCategoryNames(itemCategoriesCache);
renderAllCategorySelects();
initAllWeightEntries();
initGoldCalculator();
initQuickCalculator();
initPhoneRegionUI({
  regionSelectId: 'customer-phone-region',
  phoneInputId: 'customer-phone-input',
  hintId: 'customer-phone-hint',
  hintMode: 'customer'
});
document.getElementById('order-item-select')?.addEventListener('change', updateOrderTotalPreview);
document.querySelector('#order-form [name="quantity"]')?.addEventListener('input', updateOrderTotalPreview);

document.getElementById('save-locations-btn')?.addEventListener('click', () => {
  persistStoreLocations().catch((err) => toast(err.message));
});
document.getElementById('save-categories-btn')?.addEventListener('click', () => {
  persistStoreItemCategories().catch((err) => toast(err.message));
});

document.getElementById('view-settings')?.addEventListener('click', (e) => {
  if (e.target.closest('#add-location-btn')) {
    e.preventDefault();
    const input = document.getElementById('new-location-input');
    addStoreLocation(input?.value).catch((err) => toast(err.message));
    return;
  }
  const removeBtn = e.target.closest('[data-remove-location]');
  if (removeBtn) {
    e.preventDefault();
    removeStoreLocation(removeBtn.dataset.removeLocation).catch((err) => toast(err.message));
    return;
  }
  if (e.target.closest('#add-category-btn')) {
    e.preventDefault();
    const input = document.getElementById('new-category-input');
    addStoreCategory(input?.value).catch((err) => toast(err.message));
    return;
  }
  const removeCategoryBtn = e.target.closest('[data-remove-category]');
  if (removeCategoryBtn) {
    e.preventDefault();
    removeStoreCategory(removeCategoryBtn.dataset.removeCategory).catch((err) => toast(err.message));
  }
});

document.getElementById('new-location-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addStoreLocation(e.target.value).catch((err) => toast(err.message));
  }
});

document.getElementById('new-category-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addStoreCategory(e.target.value).catch((err) => toast(err.message));
  }
});

document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

window.addEventListener('beforeunload', () => { flushSharedGraphTicks(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSharedGraphTicks();
});

async function initApp() {
  initDateDefaults();
  seedSampleExpenses();
  initTheme();
  setLanguage(currentLang);
  updateThemeToggleUI();
  initCurrencySelect();
  if (typeof waitForAuthReady === 'function') await waitForAuthReady();

  const authRequired = typeof isAuthRequired === 'function' && isAuthRequired();
  const token = typeof getAuthAccessToken === 'function' ? await getAuthAccessToken() : null;
  if (authRequired && !token) {
    if (typeof redirectToLogin === 'function') redirectToLogin();
    return;
  }

  const revealFailsafe = window.setTimeout(() => {
    if (typeof revealAppShell === 'function') revealAppShell();
  }, 12000);

  try {
    await refreshAll();
  } catch (err) {
    if (/sign in required/i.test(err.message)) {
      if (typeof redirectToLogin === 'function') redirectToLogin();
    } else if (typeof toast === 'function') {
      toast(err.message);
    }
  } finally {
    window.clearTimeout(revealFailsafe);
    if (typeof revealAppShell === 'function') revealAppShell();
  }
}

initApp().catch((err) => {
  if (typeof revealAppShell === 'function') revealAppShell();
  if (typeof toast === 'function') toast(err.message);
});
