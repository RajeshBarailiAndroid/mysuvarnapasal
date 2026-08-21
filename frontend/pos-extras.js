// pos-extras.js — invoices (immutable sales + void), old-gold trade-in at POS,
// gold-scheme redemption, repair jobs, and monthly gold savings schemes.
// Loaded after app.js; shares its globals (api, t, formatMoney, posCart, …).

/* eslint-disable no-undef */

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Generic close buttons for the new dialogs.
document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.closeModal)?.close());
});

// ───────────────────────── Old-gold trade-in at POS ─────────────────────────

function readPosOldGoldInputs() {
  const weightGrams = Number(document.getElementById('og-weight')?.value) || 0;
  const karat = Number(document.getElementById('og-karat')?.value) || 22;
  const rateInput = document.getElementById('og-rate');
  const rateDisplay = Number(rateInput?.value) || 0;
  // Rate is entered in the display currency per tola; convert to NPR.
  const ratePerTola = rateDisplay > 0 ? inputMoneyToNpr(rateDisplay) : 0;
  posOldGold = weightGrams > 0 && ratePerTola > 0 ? { weightGrams, karat, ratePerTola } : null;
  renderCart();
}

function resetPosOldGoldUi() {
  posOldGold = null;
  const fields = document.getElementById('old-gold-fields');
  if (fields) fields.hidden = true;
  const w = document.getElementById('og-weight');
  const k = document.getElementById('og-karat');
  const r = document.getElementById('og-rate');
  if (w) w.value = '';
  if (k) k.value = 22;
  if (r) r.value = '';
  const toggle = document.getElementById('toggle-old-gold-btn');
  if (toggle) toggle.hidden = false;
  const schemeSelect = document.getElementById('pos-scheme-select');
  if (schemeSelect) schemeSelect.value = '';
}

document.getElementById('toggle-old-gold-btn')?.addEventListener('click', () => {
  const fields = document.getElementById('old-gold-fields');
  const toggle = document.getElementById('toggle-old-gold-btn');
  if (!fields) return;
  fields.hidden = false;
  if (toggle) toggle.hidden = true;
  const rateEl = document.getElementById('og-rate');
  if (rateEl && !rateEl.value) {
    // Default to the shop's configured gold buy rate (falling back to sell rate).
    const buyNpr = Number(settingsCache.goldBuyRatePerTola) || Number(goldBuyRateCache) || Number(goldRateCache) || 0;
    if (buyNpr > 0) rateEl.value = Number(nprToDisplay(buyNpr).toFixed(2));
  }
  document.getElementById('og-weight')?.focus();
});

document.getElementById('clear-old-gold-btn')?.addEventListener('click', () => {
  resetPosOldGoldUi();
  renderCart();
});

['og-weight', 'og-karat', 'og-rate'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', readPosOldGoldInputs);
});

// ─────────────────────── Scheme redemption select at POS ────────────────────

function renderPosSchemeSelect() {
  const select = document.getElementById('pos-scheme-select');
  if (!select) return;
  const current = posSchemeId;
  const redeemable = schemesCache.filter((s) => (s.status === 'active' || s.status === 'matured') && Number(s.paidTotal) > 0);
  select.innerHTML = `<option value="">${t('schemeNone')}</option>` + redeemable.map((s) =>
    `<option value="${escHtml(s.id)}">${escHtml(s.schemeNumber)} — ${escHtml(s.customerName)} · ${formatMoney(s.paidTotal)}</option>`
  ).join('');
  select.value = redeemable.some((s) => s.id === current) ? current : '';
  posSchemeId = select.value;
}

document.getElementById('pos-scheme-select')?.addEventListener('change', (e) => {
  posSchemeId = e.target.value || '';
  const scheme = schemesCache.find((s) => s.id === posSchemeId);
  if (scheme && !getSaleCustomerName()) {
    applyPosCustomer({ name: scheme.customerName, phone: scheme.customerPhone || '' });
  }
  renderCart();
});

// ─────────────────────────── Invoices (reports tab) ─────────────────────────

let salesOutstandingTotal = 0;

async function loadSales() {
  const start = document.getElementById('report-start')?.value || '';
  const end = document.getElementById('report-end')?.value || '';
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  const payload = await api(`/api/sales${params.toString() ? `?${params}` : ''}`);
  salesCache = payload.sales || [];
  salesOutstandingTotal = Number(payload.outstandingTotal) || 0;
  return salesCache;
}

function invoiceDueCell(sale) {
  const originalDue = Number(sale.payment?.due) || 0;
  if (sale.status === 'voided' || originalDue <= 0) return '—';
  const remaining = Number(sale.dueRemaining) || 0;
  if (remaining <= 0) {
    return `<span style="color:#059669;font-weight:600">${t('paidInFull')}</span>`
      + `<div style="font-size:.72rem">${t('givenSoFar')}: ${formatMoney(sale.paidSince || originalDue)}</div>`;
  }
  const given = Number(sale.paidSince) || 0;
  return `<span style="color:#b91c1c;font-weight:700">${formatMoney(remaining)}</span>`
    + (given > 0 ? `<div style="font-size:.72rem">${t('givenSoFar')}: ${formatMoney(given)}</div>` : '');
}

function invoiceStatusBadge(sale) {
  return sale.status === 'voided'
    ? `<span style="color:#b91c1c;font-weight:700">${t('voidedStamp')}</span>`
    : `<span style="color:#059669;font-weight:600">${t('invoiceCompleted')}</span>`;
}

async function renderInvoicesReport() {
  const statsEl = document.getElementById('stats-grid');
  const bodyEl = document.getElementById('report-body');
  if (!bodyEl) return;
  try { await loadSales(); } catch (err) { bodyEl.innerHTML = `<p class="panel-desc">${escHtml(err.message)}</p>`; return; }
  const active = salesCache.filter((s) => s.status !== 'voided');
  const voided = salesCache.filter((s) => s.status === 'voided');
  // Opening-balance dues owe money but are not revenue.
  const revenue = active.filter((s) => s.type !== 'opening_due').reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  if (statsEl) {
    const kpi = (label, value, sub, style = '') => `
      <div class="kpi-card"><div class="kpi-card-head"><div>
        <span class="label">${label}</span>
        <strong${style ? ` style="${style}"` : ''}>${value}</strong>
        ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
      </div></div></div>`;
    statsEl.innerHTML = [
      kpi(t('invoicesCount'), active.length, ''),
      kpi(t('invoiceRevenue'), formatMoney(revenue), ''),
      kpi(t('outstandingCredit'), formatMoney(salesOutstandingTotal), '', salesOutstandingTotal > 0 ? 'color:#b91c1c' : ''),
      kpi(t('voidedCount'), voided.length, '')
    ].join('');
  }
  if (!salesCache.length) {
    bodyEl.innerHTML = `<div class="invoices-toolbar"><button type="button" class="btn btn-outline btn-sm" id="invoices-add-old-due">${t('manualDueBtn')}</button></div><p class="panel-desc">${t('noInvoicesYet')}</p>`;
    bodyEl.querySelector('#invoices-add-old-due')?.addEventListener('click', () => openManualDueModal());
    return;
  }
  const rows = salesCache.map((s) => `
    <tr${s.status === 'voided' ? ' style="opacity:.55"' : ''}>
      <td><strong>${escHtml(s.invoiceNumber)}</strong></td>
      <td>${new Date(s.createdAt).toLocaleString()}</td>
      <td>${escHtml(s.customerName)}</td>
      <td>${formatMoney(s.total)}</td>
      <td>${paymentMethodLabel(s.payment?.method || 'cash')}</td>
      <td>${invoiceDueCell(s)}</td>
      <td>${invoiceStatusBadge(s)}${s.voidReason ? `<div style="font-size:.75rem">${escHtml(s.voidReason)}</div>` : ''}</td>
      <td>
        ${s.status !== 'voided' && Number(s.dueRemaining) > 0 ? `<button type="button" class="btn btn-gold btn-xs" data-receive-payment="${escHtml(s.id)}">${t('receivePayment')}</button>` : ''}
        <button type="button" class="btn btn-outline btn-xs" data-reprint-sale="${escHtml(s.id)}">${t('reprintBill')}</button>
        ${s.status !== 'voided' && !(s.payments || []).length ? `<button type="button" class="btn btn-outline btn-xs" data-void-sale="${escHtml(s.id)}" style="color:#b91c1c;border-color:#b91c1c">${t('voidSale')}</button>` : ''}
      </td>
    </tr>`).join('');
  bodyEl.innerHTML = `<div class="invoices-toolbar"><button type="button" class="btn btn-outline btn-sm" id="invoices-add-old-due">${t('manualDueBtn')}</button></div>
  <div class="table-wrap"><table class="data-table"><thead><tr>
    <th>${t('receiptNo')}</th><th>${t('date')}</th><th>${t('customer')}</th><th>${t('total')}</th>
    <th>${t('paymentMethod')}</th><th>${t('dueRemaining')}</th><th>${t('status')}</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;

  bodyEl.querySelector('#invoices-add-old-due')?.addEventListener('click', () => openManualDueModal());

  bodyEl.querySelectorAll('[data-receive-payment]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sale = salesCache.find((s) => s.id === btn.dataset.receivePayment);
      if (!sale) return;
      document.getElementById('receive-payment-sale-id').value = sale.id;
      const amountEl = document.getElementById('receive-payment-amount');
      if (amountEl) amountEl.value = Number(nprToDisplay(sale.dueRemaining).toFixed(2));
      const dateEl = document.getElementById('receive-payment-date');
      if (dateEl) dateEl.value = todayDateStr();
      const noteEl = document.getElementById('receive-payment-note');
      if (noteEl) noteEl.value = '';
      document.getElementById('receive-payment-summary').textContent =
        `${sale.invoiceNumber} — ${sale.customerName} · ${t('dueRemaining')}: ${formatMoney(sale.dueRemaining)}`;
      document.getElementById('receive-payment-modal')?.showModal();
    });
  });

  bodyEl.querySelectorAll('[data-reprint-sale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sale = salesCache.find((s) => s.id === btn.dataset.reprintSale);
      if (sale) renderSaleBill(serverSaleToBill(sale));
    });
  });
  bodyEl.querySelectorAll('[data-void-sale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sale = salesCache.find((s) => s.id === btn.dataset.voidSale);
      if (!sale) return;
      document.getElementById('void-sale-id').value = sale.id;
      document.getElementById('void-sale-reason').value = '';
      document.getElementById('void-sale-summary').textContent =
        `${sale.invoiceNumber} — ${sale.customerName} · ${formatMoney(sale.total)}`;
      document.getElementById('void-sale-modal')?.showModal();
    });
  });
}

// ─────────────── Opening balance / manual due (old khata udharo) ────────────

function openManualDueModal() {
  const form = document.getElementById('manual-due-form');
  if (form) form.reset();
  document.getElementById('manual-due-modal')?.showModal();
}

document.getElementById('manual-due-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/sales/manual-due', {
      method: 'POST',
      body: JSON.stringify({
        customerName: fd.get('customerName'),
        customerPhone: fd.get('customerPhone'),
        amount: inputMoneyToNpr(fd.get('amount')),
        date: fd.get('date'),
        note: fd.get('note')
      })
    });
    document.getElementById('manual-due-modal')?.close();
    toast(t('dueSaved'));
    if (activeView === 'reports') renderInvoicesReport();
    if (activeView === 'dashboard' && typeof loadDashboard === 'function') loadDashboard().catch(() => {});
  } catch (err) { toast(err.message); }
});

document.getElementById('receive-payment-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('receive-payment-sale-id').value;
  try {
    await api(`/api/sales/${encodeURIComponent(id)}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: inputMoneyToNpr(document.getElementById('receive-payment-amount').value),
        method: document.getElementById('receive-payment-method').value,
        date: document.getElementById('receive-payment-date').value,
        note: document.getElementById('receive-payment-note').value
      })
    });
    document.getElementById('receive-payment-modal')?.close();
    toast(t('paymentReceived'));
    if (activeView === 'reports') renderInvoicesReport();
    if (activeView === 'dashboard' && typeof loadDashboard === 'function') loadDashboard().catch(() => {});
  } catch (err) { toast(err.message); }
});

document.getElementById('void-sale-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('void-sale-id').value;
  const reason = document.getElementById('void-sale-reason').value.trim();
  if (!id || !reason) return;
  try {
    await api(`/api/sales/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({ reason }) });
    document.getElementById('void-sale-modal')?.close();
    toast(t('saleVoided'));
    renderInvoicesReport();
    if (typeof loadSchemes === 'function') loadSchemes().catch(() => {});
  } catch (err) { toast(err.message); }
});

// ──────────────────────────────── Repairs ───────────────────────────────────

let repairStatusFilter = '';

const REPAIR_STATUS_LABEL_KEYS = {
  received: 'repairReceived', in_progress: 'repairInProgress',
  ready: 'repairReady', delivered: 'repairDelivered', cancelled: 'repairCancelled'
};

function repairStatusLabel(status) {
  return t(REPAIR_STATUS_LABEL_KEYS[status] || 'repairReceived');
}

async function loadRepairs() {
  const payload = await api('/api/repairs');
  repairsCache = payload.repairs || [];
  renderRepairsTable();
}

function renderRepairsTable() {
  const el = document.getElementById('repairs-table');
  if (!el) return;
  const list = repairStatusFilter ? repairsCache.filter((r) => r.status === repairStatusFilter) : repairsCache;
  if (!list.length) {
    el.innerHTML = `<p class="panel-desc">${t('noRepairs')}</p>`;
    return;
  }
  const rows = list.map((r) => {
    const actions = [];
    if (r.status === 'received') actions.push(`<button type="button" class="btn btn-outline btn-xs" data-repair-advance="${escHtml(r.id)}" data-next="in_progress">${t('repairStart')}</button>`);
    if (r.status === 'in_progress') actions.push(`<button type="button" class="btn btn-outline btn-xs" data-repair-advance="${escHtml(r.id)}" data-next="ready">${t('repairMarkReady')}</button>`);
    if (r.status === 'ready') actions.push(`<button type="button" class="btn btn-gold btn-xs" data-repair-deliver="${escHtml(r.id)}">${t('repairDeliver')}</button>`);
    if (r.status !== 'delivered' && r.status !== 'cancelled') actions.push(`<button type="button" class="btn btn-outline btn-xs" data-repair-cancel="${escHtml(r.id)}">${t('cancel')}</button>`);
    if (r.status === 'cancelled') actions.push(`<button type="button" class="btn btn-outline btn-xs" data-repair-delete="${escHtml(r.id)}">${t('delete')}</button>`);
    const charge = r.status === 'delivered'
      ? `${formatMoney(r.finalCharge || 0)} · ${paymentMethodLabel(r.paymentMethod || 'cash')}`
      : (r.estimatedCharge > 0 ? `${t('repairEstPrefix')} ${formatMoney(r.estimatedCharge)}` : '—');
    return `<tr>
      <td><strong>${escHtml(r.repairNumber)}</strong></td>
      <td>${new Date(r.createdAt).toLocaleDateString()}</td>
      <td>${escHtml(r.customerName)}${r.customerPhone ? `<div style="font-size:.75rem">${escHtml(r.customerPhone)}</div>` : ''}</td>
      <td>${escHtml(r.itemDescription)}${r.weightGrams ? ` · ${escHtml(r.weightGrams)}g` : ''}${r.wastageGrams > 0 ? ` · <span style=\"color:#b45309\">जर्ती ${escHtml(r.wastageGrams)}g</span>` : ''}</td>
      <td>${repairStatusLabel(r.status)}</td>
      <td>${charge}</td>
      <td>${r.promisedDate ? escHtml(r.promisedDate) : '—'}</td>
      <td>${actions.join(' ')}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="data-table"><thead><tr>
    <th>#</th><th>${t('date')}</th><th>${t('customer')}</th><th>${t('repairItemDesc')}</th>
    <th>${t('status')}</th><th>${t('repairCharge')}</th><th>${t('repairPromised')}</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  el.querySelectorAll('[data-repair-advance]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/repairs/${encodeURIComponent(btn.dataset.repairAdvance)}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.next }) });
        await loadRepairs();
      } catch (err) { toast(err.message); }
    });
  });
  el.querySelectorAll('[data-repair-deliver]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const repair = repairsCache.find((r) => r.id === btn.dataset.repairDeliver);
      if (!repair) return;
      document.getElementById('repair-deliver-id').value = repair.id;
      const chargeEl = document.getElementById('repair-final-charge');
      if (chargeEl) chargeEl.value = repair.estimatedCharge > 0 ? Number(nprToDisplay(repair.estimatedCharge).toFixed(2)) : '';
      const wastageEl = document.getElementById('repair-wastage');
      if (wastageEl) wastageEl.value = repair.wastageGrams > 0 ? repair.wastageGrams : '';
      document.getElementById('repair-deliver-summary').textContent =
        `${repair.repairNumber} — ${repair.customerName} · ${repair.itemDescription}`;
      document.getElementById('repair-deliver-modal')?.showModal();
    });
  });
  el.querySelectorAll('[data-repair-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/repairs/${encodeURIComponent(btn.dataset.repairCancel)}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
        await loadRepairs();
      } catch (err) { toast(err.message); }
    });
  });
  el.querySelectorAll('[data-repair-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/repairs/${encodeURIComponent(btn.dataset.repairDelete)}`, { method: 'DELETE' });
        await loadRepairs();
      } catch (err) { toast(err.message); }
    });
  });
}

document.querySelectorAll('#repair-status-tabs [data-repair-status]').forEach((tab) => {
  tab.addEventListener('click', () => {
    repairStatusFilter = tab.dataset.repairStatus || '';
    document.querySelectorAll('#repair-status-tabs [data-repair-status]').forEach((b) => b.classList.toggle('is-active', b === tab));
    renderRepairsTable();
  });
});

document.getElementById('add-repair-btn')?.addEventListener('click', () => {
  document.getElementById('repair-form')?.reset();
  document.getElementById('repair-modal')?.showModal();
});

document.getElementById('repair-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/repairs', {
      method: 'POST',
      body: JSON.stringify({
        customerName: fd.get('customerName'),
        customerPhone: fd.get('customerPhone'),
        itemDescription: fd.get('itemDescription'),
        weightGrams: Number(fd.get('weightGrams')) || 0,
        wastageGrams: Number(fd.get('wastageGrams')) || 0,
        estimatedCharge: inputMoneyToNpr(fd.get('estimatedCharge')),
        promisedDate: fd.get('promisedDate'),
        notes: fd.get('notes')
      })
    });
    document.getElementById('repair-modal')?.close();
    toast(t('repairSaved'));
    await loadRepairs();
  } catch (err) { toast(err.message); }
});

document.getElementById('repair-deliver-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('repair-deliver-id').value;
  try {
    await api(`/api/repairs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'delivered',
        finalCharge: inputMoneyToNpr(document.getElementById('repair-final-charge').value),
        wastageGrams: Number(document.getElementById('repair-wastage')?.value) || 0,
        paymentMethod: document.getElementById('repair-payment-method').value
      })
    });
    document.getElementById('repair-deliver-modal')?.close();
    toast(t('repairDelivered'));
    await loadRepairs();
  } catch (err) { toast(err.message); }
});

// ─────────────────────── Monthly gold savings schemes ───────────────────────

const SCHEME_STATUS_LABEL_KEYS = {
  active: 'schemeActive', matured: 'schemeMatured',
  redeemed: 'schemeRedeemed', cancelled: 'schemeCancelled'
};

function schemeStatusLabel(status) {
  return t(SCHEME_STATUS_LABEL_KEYS[status] || 'schemeActive');
}

async function loadSchemes() {
  const payload = await api('/api/schemes');
  schemesCache = payload.schemes || [];
  renderSchemesTable();
  renderPosSchemeSelect();
}

function renderSchemesTable() {
  const el = document.getElementById('schemes-table');
  if (!el) return;
  if (!schemesCache.length) {
    el.innerHTML = `<p class="panel-desc">${t('noSchemes')}</p>`;
    return;
  }
  const rows = schemesCache.map((s) => {
    const target = Number(s.monthlyAmount) * Number(s.durationMonths);
    const actions = [];
    if (s.status === 'active') {
      actions.push(`<button type="button" class="btn btn-gold btn-xs" data-scheme-deposit="${escHtml(s.id)}">${t('addDeposit')}</button>`);
      actions.push(`<button type="button" class="btn btn-outline btn-xs" data-scheme-cancel="${escHtml(s.id)}">${t('cancel')}</button>`);
    }
    const statusExtra = s.status === 'redeemed' && s.invoiceNumber ? `<div style="font-size:.75rem">${escHtml(s.invoiceNumber)}</div>` : '';
    return `<tr>
      <td><strong>${escHtml(s.schemeNumber)}</strong></td>
      <td>${escHtml(s.customerName)}${s.customerPhone ? `<div style="font-size:.75rem">${escHtml(s.customerPhone)}</div>` : ''}</td>
      <td>${formatMoney(s.monthlyAmount)} × ${escHtml(s.durationMonths)}</td>
      <td>${(s.installments || []).length}/${escHtml(s.durationMonths)}</td>
      <td><strong>${formatMoney(s.paidTotal || 0)}</strong> / ${formatMoney(target)}</td>
      <td>${schemeStatusLabel(s.status)}${statusExtra}</td>
      <td>${actions.join(' ')}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="data-table"><thead><tr>
    <th>#</th><th>${t('customer')}</th><th>${t('schemeMonthlyCol')}</th><th>${t('schemeDeposits')}</th>
    <th>${t('schemePaid')}</th><th>${t('status')}</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  el.querySelectorAll('[data-scheme-deposit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scheme = schemesCache.find((s) => s.id === btn.dataset.schemeDeposit);
      if (!scheme) return;
      document.getElementById('scheme-deposit-id').value = scheme.id;
      const amountEl = document.getElementById('scheme-deposit-amount');
      if (amountEl) amountEl.value = Number(nprToDisplay(scheme.monthlyAmount).toFixed(2));
      const dateEl = document.getElementById('scheme-deposit-date');
      if (dateEl) dateEl.value = todayDateStr();
      document.getElementById('scheme-deposit-summary').textContent =
        `${scheme.schemeNumber} — ${scheme.customerName} · ${t('schemePaid')}: ${formatMoney(scheme.paidTotal || 0)}`;
      document.getElementById('scheme-deposit-modal')?.showModal();
    });
  });
  el.querySelectorAll('[data-scheme-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/schemes/${encodeURIComponent(btn.dataset.schemeCancel)}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
        await loadSchemes();
      } catch (err) { toast(err.message); }
    });
  });
}

document.getElementById('add-scheme-btn')?.addEventListener('click', () => {
  document.getElementById('scheme-form')?.reset();
  document.getElementById('scheme-modal')?.showModal();
});

document.getElementById('scheme-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/schemes', {
      method: 'POST',
      body: JSON.stringify({
        customerName: fd.get('customerName'),
        customerPhone: fd.get('customerPhone'),
        monthlyAmount: inputMoneyToNpr(fd.get('monthlyAmount')),
        durationMonths: Number(fd.get('durationMonths')) || 12,
        startDate: fd.get('startDate'),
        notes: fd.get('notes')
      })
    });
    document.getElementById('scheme-modal')?.close();
    toast(t('schemeSaved'));
    await loadSchemes();
  } catch (err) { toast(err.message); }
});

document.getElementById('scheme-deposit-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('scheme-deposit-id').value;
  try {
    await api(`/api/schemes/${encodeURIComponent(id)}/installments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: inputMoneyToNpr(document.getElementById('scheme-deposit-amount').value),
        date: document.getElementById('scheme-deposit-date').value,
        method: document.getElementById('scheme-deposit-method').value
      })
    });
    document.getElementById('scheme-deposit-modal')?.close();
    toast(t('depositSaved'));
    await loadSchemes();
  } catch (err) { toast(err.message); }
});

// Keep the POS scheme select warm once auth has settled. isSignedInSync is
// true in local-dev mode (no auth configured), so this works with or without
// Supabase.
setTimeout(() => {
  const ready = typeof waitForAuthReady === 'function' ? waitForAuthReady() : Promise.resolve();
  ready.then(() => {
    if (typeof isSignedInSync === 'function' && !isSignedInSync()) return;
    loadSchemes().catch(() => {});
  }).catch(() => {});
}, 1200);
