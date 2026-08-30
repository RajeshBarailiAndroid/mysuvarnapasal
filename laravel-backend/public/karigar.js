// =================== KARIGAR MODULE ===================
// Karigar management, Gold Ledger, Old Gold Exchange
// Loaded after app.js — has access to all app.js globals

const KARIGAR_TOLA = 11.664;

let karigarsCache = [];
let goldLedgerCache = [];
let oldGoldExchangeCache = [];
let karigarEditingId = null;
let goldIssueKarigarId = null;
let goldIssueMode = 'issue';
let karigarActiveTab = 'karigar';
let karigarDetailId = null;
let ledgerKarigarFilter = '';

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function karigarBalance(k) {
  return (k.goldIssuedGrams || 0) - (k.goldReturnedGrams || 0) - (k.goldWastageGrams || 0);
}

function ordersForKarigar(karigarId) {
  const orders = (typeof ordersAllCache !== 'undefined' && Array.isArray(ordersAllCache)) ? ordersAllCache : [];
  return orders.filter((o) => o.karigarId === karigarId);
}

function formatGrams(n) {
  return (Number(n) || 0).toFixed(3);
}

// ===== Data loading =====

async function loadKarigars() {
  try {
    const [kData, glData, ogData] = await Promise.all([
      api('/api/karigar'),
      api('/api/gold-ledger'),
      api('/api/old-gold')
    ]);
    karigarsCache = kData.karigars || [];
    goldLedgerCache = glData.entries || [];
    oldGoldExchangeCache = ogData.exchanges || [];
  } catch (err) {
    karigarsCache = [];
    goldLedgerCache = [];
    oldGoldExchangeCache = [];
  }

  if (typeof activeView !== 'undefined' && activeView === 'karigar') renderKarigarView();
  if (typeof activeView !== 'undefined' && activeView === 'reports') {
    if (typeof reportTab !== 'undefined' && (reportTab === 'karigar' || reportTab === 'goldledger')) {
      renderKarigarReport(reportTab);
    }
  }
  populateOrderKarigarSelect();
}

// ===== View rendering =====

function renderKarigarView() {
  if (karigarActiveTab === 'karigar') {
    renderKarigarSummary();
    renderKarigarDetail();
    renderKarigarTable();
  } else if (karigarActiveTab === 'ledger') {
    populateLedgerKarigarFilter();
    renderGoldLedgerTable();
  } else if (karigarActiveTab === 'oldgold') {
    renderOldGoldTable();
  }
}

function renderKarigarSummary() {
  const el = document.getElementById('karigar-summary');
  if (!el) return;
  const activeCount = karigarsCache.filter((k) => k.active !== false).length;
  const totalIssued = karigarsCache.reduce((s, k) => s + (k.goldIssuedGrams || 0), 0);
  const totalReturned = karigarsCache.reduce((s, k) => s + (k.goldReturnedGrams || 0), 0);
  const totalWastage = karigarsCache.reduce((s, k) => s + (k.goldWastageGrams || 0), 0);
  const totalBalance = totalIssued - totalReturned - totalWastage;
  const openOrders = (typeof ordersAllCache !== 'undefined' && Array.isArray(ordersAllCache))
    ? ordersAllCache.filter((o) => o.karigarId && o.status !== 'completed' && o.status !== 'cancelled').length
    : 0;

  el.innerHTML = `
    <div class="karigar-summary-grid">
      <div class="karigar-stat"><span class="karigar-stat-label">Active craftsmen</span><strong>${activeCount}</strong><em>${karigarsCache.length} total</em></div>
      <div class="karigar-stat"><span class="karigar-stat-label">Gold with karigar</span><strong style="color:${totalBalance > 0.001 ? 'var(--warning,#d97706)' : 'inherit'}">${formatGrams(totalBalance)} g</strong><em>issued − returned − wastage</em></div>
      <div class="karigar-stat"><span class="karigar-stat-label">Issued / Returned</span><strong>${formatGrams(totalIssued)} / ${formatGrams(totalReturned)}</strong><em>wastage ${formatGrams(totalWastage)} g</em></div>
      <div class="karigar-stat"><span class="karigar-stat-label">Open assigned orders</span><strong>${openOrders}</strong><em>not completed / cancelled</em></div>
    </div>
  `;
}

function renderKarigarDetail() {
  const el = document.getElementById('karigar-detail');
  if (!el) return;
  if (!karigarDetailId) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const k = karigarsCache.find((x) => x.id === karigarDetailId);
  if (!k) {
    karigarDetailId = null;
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const balance = karigarBalance(k);
  const orders = ordersForKarigar(k.id);
  const openOrders = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled');
  const ledger = goldLedgerCache.filter((e) => e.karigarId === k.id).slice(0, 8);

  el.hidden = false;
  el.innerHTML = `
    <div class="karigar-detail-card">
      <header class="karigar-detail-head">
        <div>
          <h3>${escHtml(k.name)} ${k.active === false ? '<span class="karigar-badge is-inactive">Inactive</span>' : '<span class="karigar-badge is-active">Active</span>'}</h3>
          <p>${escHtml(k.specialty || 'No specialty set')} · ${escHtml(k.phone || 'No phone')} · ${escHtml(k.address || 'No address')}</p>
          ${k.notes ? `<p class="karigar-detail-notes">${escHtml(k.notes)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="close-karigar-detail">Close detail</button>
      </header>
      <div class="karigar-detail-stats">
        <div><span>Issued</span><strong>${formatGrams(k.goldIssuedGrams)} g</strong></div>
        <div><span>Returned</span><strong>${formatGrams(k.goldReturnedGrams)} g</strong></div>
        <div><span>Wastage</span><strong>${formatGrams(k.goldWastageGrams)} g</strong></div>
        <div><span>Balance with them</span><strong style="color:${balance > 0.001 ? 'var(--warning,#d97706)' : 'var(--success,#059669)'}">${formatGrams(balance)} g</strong></div>
        <div><span>Assigned orders</span><strong>${orders.length}</strong><em>${openOrders.length} open</em></div>
      </div>
      <div class="karigar-detail-columns">
        <section>
          <h4>Recent gold movements</h4>
          ${ledger.length ? `<ul class="karigar-mini-list">${ledger.map((e) => {
            const isIssue = e.type === 'issue';
            return `<li><span class="${isIssue ? 'is-issue' : 'is-return'}">${isIssue ? '↑ Issue' : '↓ Return'}</span> ${formatGrams(e.weightGrams)} g · ${escapeHtml(e.karat || 22)}K · ${escHtml(e.date || '')}${e.wastageGrams ? ` · wastage ${formatGrams(e.wastageGrams)} g` : ''}${e.description ? ` · ${escHtml(e.description)}` : ''}</li>`;
          }).join('')}</ul>` : '<p class="karigar-empty-note">No gold issued or returned yet.</p>'}
        </section>
        <section>
          <h4>Assigned orders</h4>
          ${orders.length ? `<ul class="karigar-mini-list">${orders.slice(0, 8).map((o) => {
            const left = o.remainingPayment != null ? Number(o.remainingPayment) : null;
            return `<li><strong>${escHtml(o.orderNumber)}</strong> · ${escHtml(o.customerName || '')} · ${escHtml(o.status)}${left != null ? ` · left ${typeof formatMoney === 'function' ? formatMoney(left) : left}` : ''}</li>`;
          }).join('')}</ul>` : '<p class="karigar-empty-note">No orders assigned to this karigar.</p>'}
        </section>
      </div>
      <div class="karigar-detail-actions">
        <button type="button" class="btn btn-outline btn-sm" data-karigar-issue="${escHtml(k.id)}">↑ Issue gold</button>
        <button type="button" class="btn btn-outline btn-sm" data-karigar-return="${escHtml(k.id)}">↓ Return gold</button>
        <button type="button" class="btn btn-outline btn-sm" data-karigar-edit="${escHtml(k.id)}">Edit profile</button>
        <button type="button" class="btn btn-outline btn-sm" data-karigar-ledger="${escHtml(k.id)}">Open full ledger</button>
      </div>
    </div>
  `;
}

function renderKarigarTable() {
  const el = document.getElementById('karigar-table');
  if (!el) return;

  if (!karigarsCache.length) {
    el.innerHTML = `<table class="data-table"><tbody><tr class="empty-row"><td colspan="10">No karigar found. Add a craftsman to track gold issue/return and order assignment.</td></tr></tbody></table>`;
    return;
  }

  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Craftsman</th>
      <th>Contact</th>
      <th>Specialty</th>
      <th title="Gold given to karigar">Issued (g)</th>
      <th title="Finished gold returned">Returned (g)</th>
      <th title="Loss recorded on return">Wastage (g)</th>
      <th title="Issued − Returned − Wastage">Balance (g)</th>
      <th title="Orders linked to this karigar">Orders</th>
      <th>Status</th>
      <th></th>
    </tr></thead>
    <tbody>
      ${karigarsCache.map((k) => {
        const issued = k.goldIssuedGrams || 0;
        const returned = k.goldReturnedGrams || 0;
        const wastage = k.goldWastageGrams || 0;
        const balance = issued - returned - wastage;
        const orders = ordersForKarigar(k.id);
        const openCount = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled').length;
        const selected = karigarDetailId === k.id ? ' class="is-selected-row"' : '';
        return `<tr${selected} data-karigar-row="${escHtml(k.id)}" style="cursor:pointer">
          <td>
            <strong>${escHtml(k.name)}</strong>
            ${k.notes ? `<div class="karigar-cell-sub">${escHtml(k.notes)}</div>` : ''}
          </td>
          <td>
            <div>${escHtml(k.phone || '—')}</div>
            ${k.address ? `<div class="karigar-cell-sub">${escHtml(k.address)}</div>` : ''}
          </td>
          <td>${escHtml(k.specialty || '—')}</td>
          <td>${formatGrams(issued)}</td>
          <td>${formatGrams(returned)}</td>
          <td>${formatGrams(wastage)}</td>
          <td style="font-weight:600;color:${balance > 0.001 ? 'var(--warning,#d97706)' : 'var(--success,#059669)'}">${formatGrams(balance)}</td>
          <td>${orders.length ? `${orders.length}<div class="karigar-cell-sub">${openCount} open</div>` : '—'}</td>
          <td>${k.active !== false ? '<span class="karigar-badge is-active">Active</span>' : '<span class="karigar-badge is-inactive">Inactive</span>'}</td>
          <td class="row-actions">
            <button class="btn btn-outline btn-xs" data-karigar-issue="${escHtml(k.id)}" title="Give gold to karigar">↑ Issue</button>
            <button class="btn btn-outline btn-xs" data-karigar-return="${escHtml(k.id)}" title="Record returned gold + wastage">↓ Return</button>
            <button class="btn btn-outline btn-xs" data-karigar-edit="${escHtml(k.id)}">Edit</button>
            <button class="btn btn-outline btn-xs" style="color:var(--danger,#dc2626)" data-karigar-delete="${escHtml(k.id)}">Delete</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function populateLedgerKarigarFilter() {
  const select = document.getElementById('ledger-karigar-filter');
  if (!select) return;
  const current = ledgerKarigarFilter;
  select.innerHTML = '<option value="">All karigar</option>' +
    karigarsCache.map((k) => `<option value="${escHtml(k.id)}">${escHtml(k.name)}</option>`).join('');
  select.value = current;
}

function renderGoldLedgerTable() {
  const el = document.getElementById('gold-ledger-table');
  if (!el) return;

  const entries = ledgerKarigarFilter
    ? goldLedgerCache.filter((e) => e.karigarId === ledgerKarigarFilter)
    : goldLedgerCache;

  if (!entries.length) {
    el.innerHTML = `<table class="data-table"><tbody><tr class="empty-row"><td colspan="8">No gold ledger entries yet. Issue or return gold from the Craftsmen tab.</td></tr></tbody></table>`;
    return;
  }

  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Date</th><th>Karigar</th><th>Movement</th><th>Karat</th>
      <th>Weight (g)</th><th>Wastage (g)</th><th>Description</th><th>Net effect</th>
    </tr></thead>
    <tbody>
      ${entries.map((e) => {
        const isIssue = e.type === 'issue';
        const wastage = e.wastageGrams || 0;
        const net = isIssue ? (e.weightGrams || 0) : -((e.weightGrams || 0) + wastage);
        return `<tr>
          <td>${escHtml(e.date || (e.createdAt || '').slice(0, 10))}</td>
          <td>${escHtml(e.karigarName || '—')}</td>
          <td style="color:${isIssue ? 'var(--warning,#d97706)' : 'var(--success,#059669)'}">
            ${isIssue ? '↑ Issued to karigar' : '↓ Returned to shop'}
          </td>
          <td>${escapeHtml(e.karat || 22)}K</td>
          <td>${formatGrams(e.weightGrams)}</td>
          <td>${isIssue ? '—' : formatGrams(wastage)}</td>
          <td>${escHtml(e.description || '—')}</td>
          <td style="font-weight:600;color:${net > 0 ? 'var(--warning,#d97706)' : 'var(--success,#059669)'}">${net > 0 ? '+' : ''}${formatGrams(net)} g</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function renderOldGoldTable() {
  const el = document.getElementById('old-gold-table');
  if (!el) return;

  if (!oldGoldExchangeCache.length) {
    el.innerHTML = `<table class="data-table"><tbody><tr class="empty-row"><td colspan="8">No old gold exchanges recorded yet.</td></tr></tbody></table>`;
    return;
  }

  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Date</th><th>Customer</th><th>Phone</th><th>Karat</th>
      <th>Weight (g)</th><th>Rate/Tola</th><th>Buy Value</th><th></th>
    </tr></thead>
    <tbody>
      ${oldGoldExchangeCache.map(e => `<tr>
        <td>${escHtml(e.date || (e.createdAt || '').slice(0, 10))}</td>
        <td>${escHtml(e.customerName)}</td>
        <td>${escHtml(e.customerPhone || '—')}</td>
        <td>${escapeHtml(e.karat || 22)}K</td>
        <td>${(e.weightGrams || 0).toFixed(3)}</td>
        <td>${typeof formatMoney === 'function' ? formatMoney(e.ratePerTola) : e.ratePerTola}</td>
        <td><strong>${typeof formatMoney === 'function' ? formatMoney(e.buyValue) : e.buyValue}</strong></td>
        <td class="row-actions">
          <button class="btn btn-outline btn-xs" style="color:var(--danger,#dc2626)" data-og-delete="${escHtml(e.id)}">Delete</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ===== Karigar Modal =====

function openKarigarModal(karigar) {
  karigarEditingId = karigar?.id || null;
  const modal = document.getElementById('karigar-modal');
  const form = document.getElementById('karigar-form');
  if (!modal || !form) return;

  const title = document.getElementById('karigar-modal-title');
  if (title) title.textContent = karigar ? 'Edit Karigar Profile' : 'Add Karigar';
  form.reset();

  if (karigar) {
    form.name.value = karigar.name || '';
    form.phone.value = karigar.phone || '';
    form.specialty.value = karigar.specialty || '';
    if (form.address) form.address.value = karigar.address || '';
    form.notes.value = karigar.notes || '';
    if (form.active) form.active.checked = karigar.active !== false;
  } else if (form.active) {
    form.active.checked = true;
  }
  modal.showModal();
}

// ===== Gold Issue/Return Modal =====

function openGoldIssueModal(karigarId, mode) {
  const karigar = karigarsCache.find(k => k.id === karigarId);
  if (!karigar) return;

  goldIssueKarigarId = karigarId;
  goldIssueMode = mode || 'issue';

  const modal = document.getElementById('gold-issue-modal');
  const form = document.getElementById('gold-issue-form');
  if (!modal || !form) return;

  const titleEl = document.getElementById('gold-issue-modal-title');
  const nameEl = document.getElementById('gold-issue-karigar-name');
  const idEl = document.getElementById('gold-issue-karigar-id');
  const submitBtn = document.getElementById('gold-issue-submit-btn');
  const hintEl = document.getElementById('gold-issue-type-hint');
  const wastageWrap = document.getElementById('gold-wastage-wrap');

  if (titleEl) titleEl.textContent = goldIssueMode === 'issue' ? `Issue Gold → ${karigar.name}` : `Return Gold ← ${karigar.name}`;
  if (nameEl) nameEl.value = karigar.name;
  if (idEl) idEl.value = karigar.id;
  if (submitBtn) submitBtn.textContent = goldIssueMode === 'issue' ? 'Issue Gold' : 'Record Return';
  if (hintEl) hintEl.textContent = goldIssueMode === 'issue'
    ? 'Issue: raw/pure gold given to the karigar for making ornaments. Increases their outstanding balance.'
    : 'Return: finished gold back to the shop. Record any wastage/loss separately — both reduce the outstanding balance.';
  if (wastageWrap) wastageWrap.hidden = goldIssueMode === 'issue';

  form.reset();
  if (idEl) idEl.value = karigar.id;
  const dateInput = form.querySelector('[name="date"]');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  modal.showModal();
}

// ===== Order Form Integration =====

function populateOrderKarigarSelect() {
  const select = document.getElementById('order-karigar-select');
  if (!select) return;
  const activeKarigars = karigarsCache.filter(k => k.active !== false);
  select.innerHTML = '<option value="">— None —</option>' +
    activeKarigars.map(k => `<option value="${escHtml(k.id)}">${escHtml(k.name)}</option>`).join('');
}

// ===== Karigar Report =====

function renderKarigarReport(tab) {
  const statsGrid = document.getElementById('stats-grid');
  const reportBody = document.getElementById('report-body');
  if (!statsGrid || !reportBody) return;

  if (tab === 'karigar') {
    const totalIssued = karigarsCache.reduce((s, k) => s + (k.goldIssuedGrams || 0), 0);
    const totalReturned = karigarsCache.reduce((s, k) => s + (k.goldReturnedGrams || 0), 0);
    const totalWastage = karigarsCache.reduce((s, k) => s + (k.goldWastageGrams || 0), 0);
    const totalBalance = totalIssued - totalReturned - totalWastage;

    statsGrid.innerHTML = `
      <div class="kpi-card"><p class="kpi-label">Total Karigar</p><p class="kpi-value">${karigarsCache.length}</p></div>
      <div class="kpi-card"><p class="kpi-label">Gold Issued (g)</p><p class="kpi-value">${totalIssued.toFixed(2)}</p></div>
      <div class="kpi-card"><p class="kpi-label">Gold Returned (g)</p><p class="kpi-value">${totalReturned.toFixed(2)}</p></div>
      <div class="kpi-card"><p class="kpi-label">Total Wastage (g)</p><p class="kpi-value">${totalWastage.toFixed(2)}</p></div>
      <div class="kpi-card"><p class="kpi-label">Gold Balance (g)</p><p class="kpi-value" style="color:${totalBalance > 0.001 ? 'var(--warning,#d97706)' : 'inherit'}">${totalBalance.toFixed(2)}</p></div>
    `;

    reportBody.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Karigar</th><th>Phone</th><th>Specialty</th>
          <th>Issued (g)</th><th>Returned (g)</th><th>Wastage (g)</th>
          <th>Balance (g)</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${karigarsCache.length ? karigarsCache.map(k => {
            const bal = (k.goldIssuedGrams || 0) - (k.goldReturnedGrams || 0) - (k.goldWastageGrams || 0);
            return `<tr>
              <td><strong>${escHtml(k.name)}</strong></td>
              <td>${escHtml(k.phone || '—')}</td>
              <td>${escHtml(k.specialty || '—')}</td>
              <td>${(k.goldIssuedGrams || 0).toFixed(2)}</td>
              <td>${(k.goldReturnedGrams || 0).toFixed(2)}</td>
              <td>${(k.goldWastageGrams || 0).toFixed(2)}</td>
              <td style="font-weight:600;color:${bal > 0.001 ? 'var(--warning,#d97706)' : 'var(--success,#059669)'}">${bal.toFixed(2)}</td>
              <td>${k.active !== false ? 'Active' : 'Inactive'}</td>
            </tr>`;
          }).join('') : '<tr class="empty-row"><td colspan="8">No karigar recorded.</td></tr>'}
        </tbody>
      </table></div>
    `;
  } else if (tab === 'goldledger') {
    const issuedTotal = goldLedgerCache.filter(e => e.type === 'issue').reduce((s, e) => s + (e.weightGrams || 0), 0);
    const returnedTotal = goldLedgerCache.filter(e => e.type === 'return').reduce((s, e) => s + (e.weightGrams || 0), 0);
    const wastageTotal = goldLedgerCache.filter(e => e.type === 'return').reduce((s, e) => s + (e.wastageGrams || 0), 0);
    const ogTotal = oldGoldExchangeCache.reduce((s, e) => s + (e.buyValue || 0), 0);

    statsGrid.innerHTML = `
      <div class="kpi-card"><p class="kpi-label">Ledger Entries</p><p class="kpi-value">${goldLedgerCache.length}</p></div>
      <div class="kpi-card"><p class="kpi-label">Gold Issued (g)</p><p class="kpi-value">${issuedTotal.toFixed(2)}</p></div>
      <div class="kpi-card"><p class="kpi-label">Gold Returned (g)</p><p class="kpi-value">${returnedTotal.toFixed(2)}</p></div>
      <div class="kpi-card"><p class="kpi-label">Total Wastage (g)</p><p class="kpi-value">${wastageTotal.toFixed(2)}</p></div>
      <div class="kpi-card"><p class="kpi-label">Old Gold Purchases</p><p class="kpi-value">${oldGoldExchangeCache.length}</p></div>
      <div class="kpi-card"><p class="kpi-label">Old Gold Total</p><p class="kpi-value">${typeof formatMoney === 'function' ? formatMoney(ogTotal) : ogTotal}</p></div>
    `;

    reportBody.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Date</th><th>Karigar</th><th>Type</th><th>Karat</th>
          <th>Weight (g)</th><th>Wastage (g)</th><th>Description</th>
        </tr></thead>
        <tbody>
          ${goldLedgerCache.length ? goldLedgerCache.map(e => {
            const isIssue = e.type === 'issue';
            return `<tr>
              <td>${escHtml(e.date || (e.createdAt || '').slice(0, 10))}</td>
              <td>${escHtml(e.karigarName || '—')}</td>
              <td style="color:${isIssue ? 'var(--warning,#d97706)' : 'var(--success,#059669)'}">${isIssue ? '↑ Issued' : '↓ Returned'}</td>
              <td>${escapeHtml(e.karat || 22)}K</td>
              <td>${(e.weightGrams || 0).toFixed(3)}</td>
              <td>${(e.wastageGrams || 0).toFixed(3)}</td>
              <td>${escHtml(e.description || '—')}</td>
            </tr>`;
          }).join('') : '<tr class="empty-row"><td colspan="7">No ledger entries recorded.</td></tr>'}
        </tbody>
      </table></div>
    `;
  }
}

// ===== Event Listeners =====

// Karigar view buttons
document.getElementById('add-karigar-btn')?.addEventListener('click', () => openKarigarModal(null));
document.getElementById('refresh-karigar')?.addEventListener('click', () => loadKarigars().catch(err => toast(err.message)));

// Karigar modal
document.getElementById('close-karigar-modal')?.addEventListener('click', () => document.getElementById('karigar-modal')?.close());
document.getElementById('cancel-karigar-modal')?.addEventListener('click', () => document.getElementById('karigar-modal')?.close());

document.getElementById('karigar-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = {
    name: form.name.value.trim(),
    phone: form.phone.value.trim(),
    specialty: form.specialty.value.trim(),
    address: form.address?.value?.trim() || '',
    notes: form.notes.value.trim(),
    active: Boolean(form.active?.checked)
  };
  if (!body.name) { if (typeof toast === 'function') toast('Karigar name is required.'); return; }
  try {
    if (karigarEditingId) {
      await api(`/api/karigar/${karigarEditingId}`, { method: 'PUT', body: JSON.stringify(body) });
      if (typeof toast === 'function') toast('Karigar updated.');
    } else {
      await api('/api/karigar', { method: 'POST', body: JSON.stringify(body) });
      if (typeof toast === 'function') toast('Karigar added.');
    }
    document.getElementById('karigar-modal')?.close();
    await loadKarigars();
  } catch (err) { if (typeof toast === 'function') toast(err.message); }
});

// Karigar table actions (issue, return, edit, delete, detail)
document.getElementById('karigar-table')?.addEventListener('click', async (e) => {
  const issueBtn = e.target.closest('[data-karigar-issue]');
  const returnBtn = e.target.closest('[data-karigar-return]');
  const editBtn = e.target.closest('[data-karigar-edit]');
  const deleteBtn = e.target.closest('[data-karigar-delete]');
  const row = e.target.closest('[data-karigar-row]');

  if (issueBtn) { openGoldIssueModal(issueBtn.dataset.karigarIssue, 'issue'); return; }
  if (returnBtn) { openGoldIssueModal(returnBtn.dataset.karigarReturn, 'return'); return; }
  if (editBtn) {
    const karigar = karigarsCache.find(k => k.id === editBtn.dataset.karigarEdit);
    if (karigar) openKarigarModal(karigar);
    return;
  }
  if (deleteBtn && confirm('Delete this karigar? Their ledger entries will remain.')) {
    try {
      await api(`/api/karigar/${deleteBtn.dataset.karigarDelete}`, { method: 'DELETE' });
      if (karigarDetailId === deleteBtn.dataset.karigarDelete) karigarDetailId = null;
      if (typeof toast === 'function') toast('Karigar deleted.');
      await loadKarigars();
    } catch (err) { if (typeof toast === 'function') toast(err.message); }
    return;
  }
  if (e.target.closest('.row-actions')) return; // clicks in the actions cell never toggle the detail card
  if (row?.dataset.karigarRow) {
    karigarDetailId = karigarDetailId === row.dataset.karigarRow ? null : row.dataset.karigarRow;
    renderKarigarDetail();
    renderKarigarTable();
  }
});

document.getElementById('karigar-detail')?.addEventListener('click', (e) => {
  if (e.target.closest('#close-karigar-detail')) {
    karigarDetailId = null;
    renderKarigarDetail();
    renderKarigarTable();
    return;
  }
  const issueBtn = e.target.closest('[data-karigar-issue]');
  const returnBtn = e.target.closest('[data-karigar-return]');
  const editBtn = e.target.closest('[data-karigar-edit]');
  const ledgerBtn = e.target.closest('[data-karigar-ledger]');
  if (issueBtn) openGoldIssueModal(issueBtn.dataset.karigarIssue, 'issue');
  if (returnBtn) openGoldIssueModal(returnBtn.dataset.karigarReturn, 'return');
  if (editBtn) {
    const karigar = karigarsCache.find((k) => k.id === editBtn.dataset.karigarEdit);
    if (karigar) openKarigarModal(karigar);
  }
  if (ledgerBtn) {
    ledgerKarigarFilter = ledgerBtn.dataset.karigarLedger || '';
    karigarActiveTab = 'ledger';
    document.querySelectorAll('#karigar-tabs .order-group-tab').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.karigarTab === 'ledger');
    });
    const panelKarigar = document.getElementById('karigar-tab-karigar');
    const panelLedger = document.getElementById('karigar-tab-ledger');
    const panelOldGold = document.getElementById('karigar-tab-oldgold');
    if (panelKarigar) panelKarigar.hidden = true;
    if (panelLedger) panelLedger.hidden = false;
    if (panelOldGold) panelOldGold.hidden = true;
    renderKarigarView();
  }
});

document.getElementById('ledger-karigar-filter')?.addEventListener('change', (e) => {
  ledgerKarigarFilter = e.target.value || '';
  renderGoldLedgerTable();
});

// Gold issue/return modal
document.getElementById('close-gold-issue-modal')?.addEventListener('click', () => document.getElementById('gold-issue-modal')?.close());
document.getElementById('cancel-gold-issue-modal')?.addEventListener('click', () => document.getElementById('gold-issue-modal')?.close());

document.getElementById('gold-issue-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const idEl = document.getElementById('gold-issue-karigar-id');
  const karigarId = idEl?.value || goldIssueKarigarId;
  if (!karigarId) { if (typeof toast === 'function') toast('Karigar not set.'); return; }

  const body = {
    weightGrams: Number(form.querySelector('[name="weightGrams"]')?.value) || 0,
    wastageGrams: Number(form.querySelector('[name="wastageGrams"]')?.value) || 0,
    karat: Number(form.querySelector('[name="karat"]')?.value) || 22,
    date: form.querySelector('[name="date"]')?.value || '',
    description: form.querySelector('[name="description"]')?.value?.trim() || ''
  };
  if (body.weightGrams <= 0) { if (typeof toast === 'function') toast('Weight must be greater than 0.'); return; }

  const endpoint = goldIssueMode === 'issue' ? 'issue-gold' : 'return-gold';
  try {
    await api(`/api/karigar/${karigarId}/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
    if (typeof toast === 'function') toast(goldIssueMode === 'issue' ? 'Gold issued successfully.' : 'Gold return recorded.');
    document.getElementById('gold-issue-modal')?.close();
    await loadKarigars();
  } catch (err) { if (typeof toast === 'function') toast(err.message); }
});

// Old gold modal
document.getElementById('add-old-gold-btn')?.addEventListener('click', () => {
  const modal = document.getElementById('old-gold-modal');
  const form = document.getElementById('old-gold-form');
  if (!form) return;
  form.reset();
  const dateInput = form.querySelector('[name="date"]');
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
  document.getElementById('old-gold-value-preview').textContent = '';
  modal?.showModal();
});

document.getElementById('close-old-gold-modal')?.addEventListener('click', () => document.getElementById('old-gold-modal')?.close());
document.getElementById('cancel-old-gold-modal')?.addEventListener('click', () => document.getElementById('old-gold-modal')?.close());

document.getElementById('old-gold-form')?.addEventListener('input', () => {
  const form = document.getElementById('old-gold-form');
  const preview = document.getElementById('old-gold-value-preview');
  if (!form || !preview) return;
  const weight = Number(form.querySelector('[name="weightGrams"]')?.value) || 0;
  const karat = Number(form.querySelector('[name="karat"]')?.value) || 22;
  const rate = Number(form.querySelector('[name="ratePerTola"]')?.value) || 0;
  if (weight > 0 && rate > 0) {
    const tola = weight / KARIGAR_TOLA;
    const purity = karat / 24;
    const value = Math.round(tola * rate * purity);
    const formatted = typeof formatMoney === 'function' ? formatMoney(value) : value.toLocaleString();
    preview.textContent = `Estimated buy value: ${formatted}`;
  } else {
    preview.textContent = '';
  }
});

document.getElementById('old-gold-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = {
    customerName: form.querySelector('[name="customerName"]')?.value?.trim() || '',
    customerPhone: form.querySelector('[name="customerPhone"]')?.value?.trim() || '',
    weightGrams: Number(form.querySelector('[name="weightGrams"]')?.value) || 0,
    karat: Number(form.querySelector('[name="karat"]')?.value) || 22,
    ratePerTola: Number(form.querySelector('[name="ratePerTola"]')?.value) || 0,
    date: form.querySelector('[name="date"]')?.value || '',
    description: form.querySelector('[name="description"]')?.value?.trim() || ''
  };
  if (!body.customerName) { if (typeof toast === 'function') toast('Customer name is required.'); return; }
  if (body.weightGrams <= 0) { if (typeof toast === 'function') toast('Weight must be greater than 0.'); return; }
  if (body.ratePerTola <= 0) { if (typeof toast === 'function') toast('Buy rate is required.'); return; }

  try {
    await api('/api/old-gold', { method: 'POST', body: JSON.stringify(body) });
    if (typeof toast === 'function') toast('Old gold exchange recorded.');
    document.getElementById('old-gold-modal')?.close();
    await loadKarigars();
  } catch (err) { if (typeof toast === 'function') toast(err.message); }
});

document.getElementById('old-gold-table')?.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('[data-og-delete]');
  if (deleteBtn && confirm('Delete this old gold record?')) {
    try {
      await api(`/api/old-gold/${deleteBtn.dataset.ogDelete}`, { method: 'DELETE' });
      if (typeof toast === 'function') toast('Record deleted.');
      await loadKarigars();
    } catch (err) { if (typeof toast === 'function') toast(err.message); }
  }
});

// Karigar tabs (Karigar / Gold Ledger / Old Gold Exchange)
document.getElementById('karigar-tabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-karigar-tab]');
  if (!tab) return;
  karigarActiveTab = tab.dataset.karigarTab;
  document.querySelectorAll('#karigar-tabs .order-group-tab').forEach(t => {
    t.classList.toggle('is-active', t === tab);
  });
  const panelKarigar = document.getElementById('karigar-tab-karigar');
  const panelLedger = document.getElementById('karigar-tab-ledger');
  const panelOldGold = document.getElementById('karigar-tab-oldgold');
  if (panelKarigar) panelKarigar.hidden = karigarActiveTab !== 'karigar';
  if (panelLedger) panelLedger.hidden = karigarActiveTab !== 'ledger';
  if (panelOldGold) panelOldGold.hidden = karigarActiveTab !== 'oldgold';
  renderKarigarView();
});
