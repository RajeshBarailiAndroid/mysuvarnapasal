// dashboard.js — home screen: KPI cards, gold rate, quick actions,
// 7-day sales chart, recent invoices, and open credit dues.
// Loaded after app.js/pos-extras.js; shares their globals.

/* eslint-disable no-undef */

let dashboardCache = null;

function dashEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadDashboard() {
  const root = document.getElementById('dashboard-root');
  if (!root) return;
  try {
    dashboardCache = await api('/api/dashboard');
    renderDashboard();
  } catch (err) {
    root.innerHTML = `<p class="panel-desc">${dashEsc(err.message)}</p>`;
  }
}

function dashKpi(label, value, sub, accent) {
  return `
    <div class="kpi-card"><div class="kpi-card-head"><div>
      <span class="label">${label}</span>
      <strong${accent ? ` style="color:${accent}"` : ''}>${value}</strong>
      ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
    </div></div></div>`;
}

// Single-series bar chart: last 7 days of invoice revenue in the app's gold
// accent. One hue, thin marks, rounded data-ends, per-bar hover tooltip.
function dashSalesChart(days) {
  const max = Math.max(1, ...days.map((d) => d.amount));
  const bars = days.map((d, i) => {
    const hPct = Math.max(d.amount > 0 ? 4 : 1.5, Math.round((d.amount / max) * 100));
    const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    const isToday = i === days.length - 1;
    return `
      <div class="dash-bar-col" data-dash-bar="${i}">
        <div class="dash-bar-fill${isToday ? ' is-today' : ''}" style="height:${hPct}%"></div>
        <span class="dash-bar-day${isToday ? ' is-today' : ''}">${dayLabel}</span>
      </div>`;
  }).join('');
  return `
    <div class="dash-chart" id="dash-chart">
      <div class="dash-chart-bars">${bars}</div>
      <div class="dash-chart-tip" id="dash-chart-tip" hidden></div>
    </div>`;
}

function dashPayLabel(method) {
  return typeof paymentMethodLabel === 'function' ? paymentMethodLabel(method) : method;
}

function renderDashboard() {
  const root = document.getElementById('dashboard-root');
  if (!root || !dashboardCache) return;
  const d = dashboardCache;
  const now = new Date();
  const bs = typeof toBikramSambatString === 'function'
    ? toBikramSambatString(now, typeof currentLang !== 'undefined' ? currentLang : 'en') : '';
  const shop = settingsCache.shopName || 'Suvarnapasal';

  const rateChip = d.goldRatePerTola > 0
    ? `<div class="dash-rate-chip">
        <span class="dash-rate-label">${t('dashGoldToday')}</span>
        <strong>${formatMoney(d.goldRatePerTola)}<small>/${t('tola')}</small></strong>
        ${d.silverRatePerTola > 0 ? `<span class="dash-rate-silver">${t('dashSilver')}: ${formatMoney(d.silverRatePerTola)}</span>` : ''}
      </div>`
    : `<div class="dash-rate-chip dash-rate-unset">${t('dashSetRate')}</div>`;

  const recentRows = (d.recentSales || []).map((s) => `
    <tr>
      <td><strong>${dashEsc(s.invoiceNumber)}</strong></td>
      <td>${dashEsc(s.customerName)}</td>
      <td>${new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<div class="dash-td-sub">${new Date(s.createdAt).toLocaleDateString()}</div></td>
      <td>${dashPayLabel(s.method)}</td>
      <td class="dash-td-amount">${formatMoney(s.total)}${s.dueRemaining > 0 ? `<div class="dash-td-due">${t('dueRemaining')}: ${formatMoney(s.dueRemaining)}</div>` : ''}</td>
    </tr>`).join('');

  const duesRows = (d.openDues || []).map((s) => `
    <li>
      <div><strong>${dashEsc(s.customerName)}</strong><span class="dash-td-sub">${dashEsc(s.invoiceNumber)} · ${new Date(s.createdAt).toLocaleDateString()}</span></div>
      <div class="dash-due-side">
        <strong class="dash-due-amt">${formatMoney(s.dueRemaining)}</strong>
        <button type="button" class="btn btn-gold btn-xs" data-dash-receive="${dashEsc(s.id)}">${t('receivePayment')}</button>
      </div>
    </li>`).join('');

  root.innerHTML = `
    <header class="dash-head">
      <div>
        <h1 class="dash-title">${dashEsc(shop)}</h1>
        <p class="dash-date">${now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${bs ? ` · ${bs}` : ''}</p>
      </div>
      ${rateChip}
    </header>

    <div class="kpi-grid dash-kpis">
      ${dashKpi(t('dashTodaySales'), formatMoney(d.today.revenue), `${d.today.count} ${t('dashInvoicesSub')}`)}
      ${dashKpi(t('dashMonthSales'), formatMoney(d.month.revenue), `${d.month.count} ${t('dashInvoicesSub')}`)}
      ${dashKpi(t('outstandingCredit'), formatMoney(d.outstandingTotal), '', d.outstandingTotal > 0 ? '#b91c1c' : '')}
      ${dashKpi(t('dashStockValue'), formatMoney(d.inventory.value), `${d.inventory.items} ${t('dashItemsSub')} · ${d.inventory.weightGrams}g`)}
      ${dashKpi(t('dashPendingOrders'), d.pendingOrders, '')}
      ${dashKpi(t('dashActiveRepairs'), d.activeRepairs, '')}
      ${dashKpi(t('dashActiveSchemes'), d.activeSchemes, '')}
      ${dashKpi(t('dashLowStock'), d.inventory.lowStockCount, '', d.inventory.lowStockCount > 0 ? '#d97706' : '')}
    </div>

    <div class="dash-quick">
      <button type="button" class="btn btn-gold" data-dash-go="pos">＋ ${t('dashNewSale')}</button>
      <button type="button" class="btn btn-outline" data-dash-go="inventory">${t('dashAddItem')}</button>
      <button type="button" class="btn btn-outline" data-dash-go="orders">${t('dashNewOrder')}</button>
      <button type="button" class="btn btn-outline" data-dash-go="repairs">${t('dashNewRepair')}</button>
      <button type="button" class="btn btn-outline" data-dash-go="schemes">${t('dashSchemes')}</button>
      <button type="button" class="btn btn-outline" data-dash-go="invoices">${t('dashInvoices')}</button>
    </div>

    <div class="dash-grid">
      <article class="panel dash-panel">
        <h2 class="dash-panel-title">${t('dashWeekChart')}</h2>
        ${dashSalesChart(d.salesByDay || [])}
      </article>
      <article class="panel dash-panel">
        <h2 class="dash-panel-title">${t('dashRecentSales')}</h2>
        ${recentRows
          ? `<div class="table-wrap"><table class="data-table dash-table"><thead><tr><th>${t('receiptNo')}</th><th>${t('customer')}</th><th>${t('date')}</th><th>${t('paymentMethod')}</th><th>${t('total')}</th></tr></thead><tbody>${recentRows}</tbody></table></div>`
          : `<p class="panel-desc">${t('dashNoSalesYet')}</p>`}
      </article>
      <article class="panel dash-panel">
        <div class="dash-panel-title-row">
          <h2 class="dash-panel-title">${t('dashOpenDues')}</h2>
          <button type="button" class="btn btn-outline btn-xs" id="dash-add-old-due">${t('manualDueBtn')}</button>
        </div>
        ${duesRows
          ? `<ul class="dash-dues">${duesRows}</ul><button type="button" class="btn btn-outline btn-sm" data-dash-go="invoices">${t('dashViewAllDues')}</button>`
          : `<p class="panel-desc">${t('dashNoDues')}</p>`}
      </article>
    </div>`;

  // Quick actions → navigate (invoices goes to Reports with the Invoices tab).
  root.querySelectorAll('[data-dash-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.dashGo;
      if (target === 'invoices') {
        showView('reports');
        document.querySelector('.report-tab[data-tab="invoices"]')?.click();
        return;
      }
      showView(target);
      if (target === 'inventory') document.getElementById('add-item-btn')?.click();
      if (target === 'repairs') document.getElementById('add-repair-btn')?.click();
    });
  });

  // Add an opening-balance due (old paper-khata udharo).
  root.querySelector('#dash-add-old-due')?.addEventListener('click', () => {
    if (typeof openManualDueModal === 'function') openManualDueModal();
  });

  // Receive a due payment straight from the dashboard.
  root.querySelectorAll('[data-dash-receive]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const due = (d.openDues || []).find((s) => s.id === btn.dataset.dashReceive);
      if (!due) return;
      document.getElementById('receive-payment-sale-id').value = due.id;
      const amountEl = document.getElementById('receive-payment-amount');
      if (amountEl) amountEl.value = Number(nprToDisplay(due.dueRemaining).toFixed(2));
      const dateEl = document.getElementById('receive-payment-date');
      if (dateEl) dateEl.value = todayDateStr();
      const noteEl = document.getElementById('receive-payment-note');
      if (noteEl) noteEl.value = '';
      document.getElementById('receive-payment-summary').textContent =
        `${due.invoiceNumber} — ${due.customerName} · ${t('dueRemaining')}: ${formatMoney(due.dueRemaining)}`;
      document.getElementById('receive-payment-modal')?.showModal();
    });
  });

  // Per-bar hover tooltip on the sales chart.
  const tip = root.querySelector('#dash-chart-tip');
  root.querySelectorAll('[data-dash-bar]').forEach((col) => {
    col.addEventListener('mouseenter', () => {
      const day = (d.salesByDay || [])[Number(col.dataset.dashBar)];
      if (!day || !tip) return;
      tip.hidden = false;
      tip.textContent = `${new Date(day.date + 'T12:00:00').toLocaleDateString()} — ${formatMoney(day.amount)} · ${day.count} ${t('dashInvoicesSub')}`;
    });
    col.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
  });
}
