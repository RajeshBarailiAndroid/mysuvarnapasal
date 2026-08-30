// ─────────────────────────── Requested items ────────────────────────────────
//
// A customer asks for a piece the shop does not have on the shelf. This view
// records who asked and every item they asked for, so the shop can show the
// list back later and follow up. It is NOT an order: nothing is reserved,
// priced, or deducted from stock.

let requestStatusFilter = 'open';
let requestSearchTerm = '';
let editingRequestId = null;
let requestDraftItems = [];
let requestInvItemsCache = [];   // in-stock inventory items, for the item picker
let requestSelectedInv = new Set(); // inventory item ids ticked in the picker list
let requestInvFilter = '';
let requestCustomersCache = []; // existing customers, for the name picker

const REQUEST_STATUS_LABEL_KEYS = {
  open: 'requestOpen',
  fulfilled: 'requestFulfilled',
  cancelled: 'requestCancelled'
};

function requestStatusLabel(status) {
  return t(REQUEST_STATUS_LABEL_KEYS[status] || 'requestOpen');
}

function requestNewDraftItem() {
  return {
    id: `draft-${Math.random().toString(16).slice(2, 10)}`,
    itemId: null,
    name: '', category: '', karat: '', weightGrams: '', quantity: 1, price: '', note: ''
  };
}

async function loadRequests() {
  const payload = await api('/api/requests');
  requestsCache = payload.requests || [];
  renderRequestsTable();
}

// ── Live updates from the customer web link ─────────────────────────────────
//
// Requests filed through the shared /order/<code> link are written straight
// into this same list by the API. So that the shop does not have to hit
// Refresh to notice one, re-read the list every 20s while the Requested view
// is the one on screen and the window is actually visible. A modal being open
// pauses it, so an edit in progress is never yanked out from under the user.

const REQUESTS_POLL_MS = 20000;

function requestsViewIsLive() {
  if (typeof activeView !== 'undefined' && activeView !== 'requests') return false;
  if (document.visibilityState !== 'visible') return false;
  const modal = document.getElementById('request-modal');
  if (modal && modal.open) return false;
  return true;
}

setInterval(() => {
  if (!requestsViewIsLive()) return;
  loadRequests().catch(() => { /* a dropped poll is not worth a toast */ });
}, REQUESTS_POLL_MS);

// Coming back to the tab is the other moment a new request is likely waiting.
document.addEventListener('visibilitychange', () => {
  if (!requestsViewIsLive()) return;
  loadRequests().catch(() => {});
});

/**
 * Price for a requested item, in NPR: the manually entered price if the shop
 * set one, otherwise a live estimate from weight × karat × today's rate.
 * Returns { npr, isEstimate } or null when neither is possible.
 */
function requestItemPrice(item) {
  const manual = Number(item.price) || 0;
  if (manual > 0) return { npr: manual, isEstimate: false };
  if (Number(item.weightGrams) > 0 && typeof calcItemLinePrice === 'function') {
    const est = calcItemLinePrice({
      category: item.category || 'gold',
      karat: Number(item.karat) || 24,
      weightGrams: Number(item.weightGrams),
      makingCharge: 0
    });
    if (est != null && Number.isFinite(est) && est > 0) return { npr: est, isEstimate: true };
  }
  return null;
}

/**
 * One line per requested item: name, inventory code, category, requested
 * quantity, then the usual karat / weight / price detail. The code and the
 * quantity are always shown — a request that came in from the customer web
 * link is only useful if the shop can find the exact piece again.
 */
function requestItemSummary(item, requestId) {
  const bits = [];
  const code = item.itemCode || '';
  if (code) bits.push(escHtml(code));
  if (item.category) bits.push(escHtml(item.category));
  if (Number(item.karat) > 0 && itemMetalType(item) === 'gold') bits.push(`${item.karat}K`);
  if (Number(item.weightGrams) > 0) bits.push(`${item.weightGrams}g`);
  const unitShort = String(item.unit || '').split(' (')[0];   // "piece (10.5 g each)" → "piece"
  bits.push(`${t('requestItemQty')} ${Math.max(1, Number(item.quantity) || 1)}${unitShort ? ` ${escHtml(unitShort)}` : ''}`);
  const priced = requestItemPrice(item);
  const price = priced
    ? ` <span class="request-item-price">${priced.isEstimate ? '~' : ''}${formatMoney(priced.npr)}</span>`
    : '';
  const meta = bits.length ? ` <span class="request-item-meta">${bits.join(' · ')}</span>` : '';
  const note = item.note ? `<div class="request-item-note">${escHtml(item.note)}</div>` : '';
  const cartBtn = ` <button type="button" class="btn btn-outline btn-xs request-cart-btn"
    data-request-cart="${escHtml(requestId)}" data-request-cart-item="${escHtml(item.id)}">${t('requestAddToCart')}</button>`;
  return `<li><strong>${escHtml(item.name)}</strong>${meta}${price}${cartBtn}${note}</li>`;
}

function requestMatchesSearch(r, term) {
  if (!term) return true;
  const haystack = [
    r.requestNumber, r.customerName, r.customerPhone, r.note,
    ...(r.items || []).map((i) => `${i.name} ${i.itemCode || ''} ${i.category || ''} ${i.note || ''}`)
  ].join(' ').toLowerCase();
  return haystack.includes(term);
}

function renderRequestsTable() {
  const el = document.getElementById('requests-table');
  if (!el) return;
  const term = requestSearchTerm.trim().toLowerCase();
  const list = requestsCache
    .filter((r) => (requestStatusFilter ? r.status === requestStatusFilter : true))
    .filter((r) => requestMatchesSearch(r, term));

  const countEl = document.getElementById('requests-open-count');
  if (countEl) {
    const open = requestsCache.filter((r) => r.status === 'open').length;
    countEl.textContent = open ? `${open} ${t('requestOpenCountSuffix')}` : t('requestNoneOpen');
  }

  if (!list.length) {
    el.innerHTML = `<p class="panel-desc">${t('noRequests')}</p>`;
    return;
  }

  const rows = list.map((r) => {
    const actions = [];
    if (r.status === 'open') {
      actions.push(`<button type="button" class="btn btn-gold btn-xs" data-request-status="${escHtml(r.id)}" data-next="fulfilled">${t('requestMarkFulfilled')}</button>`);
      actions.push(`<button type="button" class="btn btn-outline btn-xs" data-request-status="${escHtml(r.id)}" data-next="cancelled">${t('cancel')}</button>`);
    } else {
      actions.push(`<button type="button" class="btn btn-outline btn-xs" data-request-status="${escHtml(r.id)}" data-next="open">${t('requestReopen')}</button>`);
    }
    actions.push(`<button type="button" class="btn btn-outline btn-xs" data-request-edit="${escHtml(r.id)}">${t('edit')}</button>`);
    actions.push(`<button type="button" class="btn btn-outline btn-xs" data-request-delete="${escHtml(r.id)}">${t('delete')}</button>`);

    const items = (r.items || []).length
      ? `<ul class="request-item-list">${(r.items || []).map((i) => requestItemSummary(i, r.id)).join('')}</ul>`
      : '—';

    // Requests that arrived from the shared customer link are marked, so the
    // shop can tell them apart from ones written at the counter.
    const fromLink = r.source === 'link'
      ? ` <span class="request-item-linked">${t('requestFromLink')}</span>` : '';
    const when = r.createdAt ? new Date(r.createdAt) : null;

    return `<tr>
      <td><strong>${escHtml(r.requestNumber || '')}</strong>${fromLink}</td>
      <td>${when ? `${escHtml(when.toLocaleDateString())}<div class="request-customer-phone">${escHtml(when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div>` : '—'}</td>
      <td><strong>${escHtml(r.customerName || '')}</strong>${r.customerPhone ? `<div class="request-customer-phone">${escHtml(r.customerPhone)}</div>` : ''}</td>
      <td>${items}</td>
      <td>${requestStatusLabel(r.status)}</td>
      <td>${r.note ? escHtml(r.note) : '—'}</td>
      <td>${actions.join(' ')}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<table class="data-table"><thead><tr>
    <th>#</th><th>${t('date')}</th><th>${t('customer')}</th>
    <th>${t('requestItemsColumn')}</th><th>${t('status')}</th><th>${t('notes')}</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  el.querySelectorAll('[data-request-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/requests/${encodeURIComponent(btn.dataset.requestStatus)}`, {
          method: 'PATCH', body: JSON.stringify({ status: btn.dataset.next })
        });
        await loadRequests();
      } catch (err) { toast(err.message); }
    });
  });

  el.querySelectorAll('[data-request-cart]').forEach((btn) => {
    btn.addEventListener('click', () => addRequestItemToCart(btn.dataset.requestCart, btn.dataset.requestCartItem));
  });

  el.querySelectorAll('[data-request-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openRequestModal(btn.dataset.requestEdit));
  });

  el.querySelectorAll('[data-request-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.confirm(t('requestDeleteConfirm'))) return;
      try {
        await api(`/api/requests/${encodeURIComponent(btn.dataset.requestDelete)}`, { method: 'DELETE' });
        await loadRequests();
      } catch (err) { toast(err.message); }
    });
  });
}

// ── Modal: draft item rows ──────────────────────────────────────────────────

function renderRequestDraftItems() {
  const wrap = document.getElementById('request-items-list');
  if (!wrap) return;
  wrap.innerHTML = requestDraftItems.map((item, idx) => `
    <div class="request-item-row" data-request-row="${escHtml(item.id)}">
      <div class="request-item-row-head">
        <span class="request-item-index">${idx + 1}</span>
        <button type="button" class="icon-btn" data-request-row-remove="${escHtml(item.id)}"
          title="${t('requestRemoveItem')}" aria-label="${t('requestRemoveItem')}">×</button>
      </div>
      <div class="form-grid">
        <label class="span-2 request-suggest-field"><span>${t('requestItemName')}</span>
          <input data-request-field="name" value="${escHtml(item.name)}" maxlength="200" autocomplete="off"
            placeholder="${t('requestItemNamePh')}" />
          <div class="customer-suggestions request-item-suggestions" data-request-suggest="${escHtml(item.id)}" hidden></div>
          ${item.itemId ? `<span class="request-item-linked">${t('requestFromInventory')}</span>` : ''}</label>
        <label><span>${t('itemMetal')}</span>
          <select data-request-field="category">
            <option value=""${item.category ? '' : ' selected'}>—</option>
            <option value="Gold"${item.category === 'Gold' ? ' selected' : ''}>${t('catGold')}</option>
            <option value="Silver"${item.category === 'Silver' ? ' selected' : ''}>${t('catSilver')}</option>
            <option value="Other"${item.category === 'Other' ? ' selected' : ''}>${t('catOther')}</option>
          </select></label>
        <label><span>${t('karat')}</span>
          <select data-request-field="karat">
            <option value=""${item.karat ? '' : ' selected'}>—</option>
            <option value="24"${String(item.karat) === '24' ? ' selected' : ''}>24K</option>
            <option value="22"${String(item.karat) === '22' ? ' selected' : ''}>22K</option>
            <option value="18"${String(item.karat) === '18' ? ' selected' : ''}>18K</option>
            ${item.karat && !['24', '22', '18'].includes(String(item.karat)) ? `<option value="${escHtml(String(item.karat))}" selected>${escHtml(String(item.karat))}K</option>` : ''}
          </select></label>
        <label><span>${t('requestItemWeight')}</span>
          <input data-request-field="weightGrams" type="number" min="0" step="any" value="${escHtml(item.weightGrams)}" /></label>
        <label><span>${t('requestItemQty')}</span>
          <input data-request-field="quantity" type="number" min="1" step="1" value="${escHtml(item.quantity)}" /></label>
        <label><span>${t('requestItemPrice')}</span>
          <input data-request-field="price" type="number" min="0" step="0.01" value="${escHtml(item.price)}" /></label>
        <label class="span-2"><span>${t('notes')}</span>
          <input data-request-field="note" value="${escHtml(item.note)}" maxlength="300" /></label>
      </div>
    </div>`).join('');

  wrap.querySelectorAll('[data-request-row]').forEach((row) => {
    const item = requestDraftItems.find((i) => i.id === row.dataset.requestRow);
    if (!item) return;
    row.querySelectorAll('[data-request-field]').forEach((input) => {
      input.addEventListener('input', () => {
        item[input.dataset.requestField] = input.value;
        if (input.dataset.requestField === 'name') {
          item.itemId = null; // typed by hand → no longer linked to inventory
          renderRequestItemSuggestions(item, row);
        }
      });
      input.addEventListener('change', () => { item[input.dataset.requestField] = input.value; });
      if (input.dataset.requestField === 'name') {
        input.addEventListener('focus', () => renderRequestItemSuggestions(item, row));
        input.addEventListener('blur', () => setTimeout(() => {
          const box = row.querySelector('[data-request-suggest]');
          if (box) box.hidden = true;
        }, 180));
      }
    });
  });

  wrap.querySelectorAll('[data-request-row-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (requestDraftItems.length <= 1) { toast(t('requestNeedOneItem')); return; }
      requestDraftItems = requestDraftItems.filter((i) => i.id !== btn.dataset.requestRowRemove);
      renderRequestDraftItems();
    });
  });
}

function openRequestModal(id) {
  const modal = document.getElementById('request-modal');
  const form = document.getElementById('request-form');
  if (!modal || !form) return;
  form.reset();
  editingRequestId = id || null;

  const existing = id ? requestsCache.find((r) => r.id === id) : null;
  form.querySelector('[name="customerName"]').value = existing?.customerName || '';
  form.querySelector('[name="customerPhone"]').value = existing?.customerPhone || '';
  form.querySelector('[name="note"]').value = existing?.note || '';

  requestDraftItems = (existing?.items || []).length
    ? existing.items.map((i) => ({
        id: i.id || `draft-${Math.random().toString(16).slice(2, 10)}`,
        itemId: i.itemId || null,
        name: i.name || '', category: i.category || '',
        karat: i.karat ? String(i.karat) : '',
        weightGrams: i.weightGrams ? String(i.weightGrams) : '',
        quantity: i.quantity || 1,
        price: Number(i.price) > 0 ? String(Number(nprToDisplay(i.price).toFixed(2))) : '',
        note: i.note || ''
      }))
    : [requestNewDraftItem()];

  const title = document.getElementById('request-modal-title');
  if (title) title.textContent = existing ? t('requestEditTitle') : t('requestModalTitle');
  renderRequestDraftItems();
  modal.showModal();

  // New request → start on the inventory list; editing → custom rows,
  // because the existing lines live there.
  requestSelectedInv = new Set();
  requestInvFilter = '';
  const searchEl = document.getElementById('request-inv-search');
  if (searchEl) searchEl.value = '';
  setRequestItemMode(existing ? 'custom' : 'inventory');
  renderRequestInvList();

  // Load pickers in the background — the form stays usable as free text.
  api('/api/items').then((p) => {
    requestInvItemsCache = (p.items || []).filter((i) => Number(i.quantity) > 0 && i.status !== 'sold');
    renderRequestInvList();
  }).catch(() => {});
  api('/api/customers').then((p) => {
    requestCustomersCache = p.customers || [];
  }).catch(() => {});
}

function requestDraftPayloadItems() {
  const custom = requestDraftItems
    .map((i) => ({
      itemId: i.itemId || null,
      name: String(i.name || '').trim(),
      category: String(i.category || '').trim(),
      karat: Number(i.karat) || 0,
      weightGrams: Number(i.weightGrams) || 0,
      quantity: Math.max(1, Math.floor(Number(i.quantity) || 1)),
      price: Math.max(0, inputMoneyToNpr(i.price)),
      note: String(i.note || '').trim()
    }))
    .filter((i) => i.name !== '');
  const customIds = new Set(custom.map((i) => i.itemId).filter(Boolean));
  const picked = requestInvItemsCache
    .filter((inv) => requestSelectedInv.has(inv.id) && !customIds.has(inv.id))
    .map((inv) => ({
      itemId: inv.id,
      name: String(inv.name || '').trim(),
      category: String(inv.category || '').trim(),
      karat: Number(inv.karat) || 0,
      weightGrams: Number(inv.weightGrams) || 0,
      quantity: 1,
      price: Math.max(0, Number(getItemDisplayPrice(inv)) || 0),
      note: ''
    }));
  return [...picked, ...custom];
}

// ── Wiring ──────────────────────────────────────────────────────────────────

document.querySelectorAll('#request-status-tabs [data-request-status-filter]').forEach((tab) => {
  tab.addEventListener('click', () => {
    requestStatusFilter = tab.dataset.requestStatusFilter || '';
    document.querySelectorAll('#request-status-tabs [data-request-status-filter]')
      .forEach((b) => b.classList.toggle('is-active', b === tab));
    renderRequestsTable();
  });
});

document.getElementById('search-requests')?.addEventListener('input', (e) => {
  requestSearchTerm = e.target.value || '';
  renderRequestsTable();
});

document.getElementById('add-request-btn')?.addEventListener('click', () => openRequestModal(null));

document.getElementById('refresh-requests')?.addEventListener('click', () => {
  loadRequests().catch((err) => toast(err.message));
});

document.getElementById('request-add-item')?.addEventListener('click', () => {
  requestDraftItems.push(requestNewDraftItem());
  renderRequestDraftItems();
});

document.getElementById('request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const items = requestDraftPayloadItems();
  if (!items.length) { toast(t('requestNeedOneItem')); return; }
  const payload = {
    customerName: String(fd.get('customerName') || '').trim(),
    customerPhone: String(fd.get('customerPhone') || '').trim(),
    note: String(fd.get('note') || '').trim(),
    items
  };
  try {
    if (editingRequestId) {
      await api(`/api/requests/${encodeURIComponent(editingRequestId)}`, {
        method: 'PATCH', body: JSON.stringify(payload)
      });
    } else {
      await api('/api/requests', { method: 'POST', body: JSON.stringify(payload) });
    }
    document.getElementById('request-modal')?.close();
    editingRequestId = null;
    toast(t('requestSaved'));
    await loadRequests();
  } catch (err) { toast(err.message); }
});

// ── Add a requested item to the POS cart ────────────────────────────────────

function addRequestItemToCart(requestId, itemId) {
  const request = requestsCache.find((r) => r.id === requestId);
  const item = request?.items?.find((i) => i.id === itemId);
  if (!request || !item) return;
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }

  const priced = requestItemPrice(item);
  if (!priced) { toast(t('requestNeedPrice')); return; }

  // The sale is for the customer who asked — put their name on the POS sale.
  if (request.customerName) {
    applyPosCustomer({ name: request.customerName, phone: request.customerPhone || '' });
  }

  const cartKey = `request-${request.id}-${item.id}`;
  const qty = Math.max(1, Number(item.quantity) || 1);
  const existing = posCart.find((l) => l.cartKey === cartKey);
  if (existing) {
    existing.qty += qty;
  } else {
    posCart.push({
      cartKey,
      itemId: cartKey,
      custom: true,
      fromRequest: request.id,
      requestNumber: request.requestNumber,
      sku: generateSku('REQ'),
      name: item.name,
      category: item.category || 'gold',
      karat: Number(item.karat) || 24,
      weightGrams: Number(item.weightGrams) || 0,
      notes: item.note || '',
      makingCharge: 0,
      qty,
      price: priced.npr
    });
  }
  renderCart();
  showView('pos');
  toast(t('requestAddedToCart'));
}

// ── Pickers: inventory items + existing customers ───────────────────────────

/** Suggestion dropdown under an item-name field, filled from inventory. */
function renderRequestItemSuggestions(item, row) {
  const box = row.querySelector('[data-request-suggest]');
  const input = row.querySelector('[data-request-field="name"]');
  if (!box || !input) return;
  const q = String(input.value || '').trim().toLowerCase();
  const matches = requestInvItemsCache.filter((inv) => {
    if (!q) return true;
    return `${inv.name} ${inv.sku || ''} ${inv.itemNumber || ''}`.toLowerCase().includes(q);
  }).slice(0, 6);
  if (!matches.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = matches.map((inv) => {
    const bits = [];
    if (Number(inv.karat) > 0 && itemMetalType(inv) === 'gold') bits.push(`${inv.karat}K`);
    if (Number(inv.weightGrams) > 0) bits.push(`${inv.weightGrams}g`);
    const price = getItemDisplayPrice(inv);
    if (price > 0) bits.push(formatMoney(price));
    return `<button type="button" data-request-inv-pick="${escHtml(inv.id)}">
      ${escHtml(inv.name)}
      <span class="suggestion-meta">${escHtml(inv.sku || '')}${bits.length ? ' · ' + bits.join(' · ') : ''}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('[data-request-inv-pick]').forEach((btn) => {
    // mousedown fires before the input's blur hides the box
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const inv = requestInvItemsCache.find((i) => i.id === btn.dataset.requestInvPick);
      if (!inv) return;
      // The focused input fires a late 'change' with the typed text when the
      // re-render removes it — sync its value first so that event is harmless.
      if (input) input.value = inv.name || '';
      item.itemId = inv.id;
      item.name = inv.name || '';
      item.category = inv.category || '';
      item.karat = Number(inv.karat) > 0 ? String(inv.karat) : '';
      item.weightGrams = Number(inv.weightGrams) > 0 ? String(inv.weightGrams) : '';
      const price = getItemDisplayPrice(inv);
      item.price = price > 0 ? String(Number(nprToDisplay(price).toFixed(2))) : '';
      renderRequestDraftItems();
    });
  });
}

/** Suggestion dropdown under the customer-name field, from existing customers. */
function renderRequestCustomerSuggestions() {
  const form = document.getElementById('request-form');
  const box = document.getElementById('request-customer-suggestions');
  const input = form?.querySelector('[name="customerName"]');
  if (!form || !box || !input) return;
  const q = String(input.value || '').trim().toLowerCase();
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  const source = requestCustomersCache.length ? requestCustomersCache : (typeof customersCache !== 'undefined' ? customersCache : []);
  const matches = source.filter((c) => `${c.name} ${c.phone || ''}`.toLowerCase().includes(q)).slice(0, 6);
  if (!matches.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-request-customer-pick="${escHtml(c.id)}">
      ${escHtml(c.name)}
      <span class="suggestion-meta">${escHtml(c.phone || c.email || '')}</span>
    </button>`).join('');
  box.querySelectorAll('[data-request-customer-pick]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const c = source.find((x) => x.id === btn.dataset.requestCustomerPick);
      if (!c) return;
      form.querySelector('[name="customerName"]').value = c.name || '';
      form.querySelector('[name="customerPhone"]').value = c.phone || '';
      box.hidden = true;
      box.innerHTML = '';
    });
  });
}

(() => {
  const form = document.getElementById('request-form');
  const input = form?.querySelector('[name="customerName"]');
  if (!input) return;
  input.addEventListener('input', renderRequestCustomerSuggestions);
  input.addEventListener('focus', renderRequestCustomerSuggestions);
  input.addEventListener('blur', () => setTimeout(() => {
    const box = document.getElementById('request-customer-suggestions');
    if (box) box.hidden = true;
  }, 180));
})();

// ── Inventory pick-list in the request modal ────────────────────────────────

function setRequestItemMode(mode) {
  document.querySelectorAll('[data-request-mode]').forEach((btn) => {
    const active = btn.dataset.requestMode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const inv = document.getElementById('request-inventory-panel');
  const custom = document.getElementById('request-custom-panel');
  if (inv) inv.hidden = mode !== 'inventory';
  if (custom) custom.hidden = mode !== 'custom';
}

/** Every in-stock item, with a tick box; the filter only hides rows. */
function renderRequestInvList() {
  const el = document.getElementById('request-inv-list');
  if (!el) return;
  const q = requestInvFilter.trim().toLowerCase();
  const list = requestInvItemsCache.filter((inv) => {
    if (!q) return true;
    return `${inv.name} ${inv.sku || ''} ${inv.itemNumber || ''}`.toLowerCase().includes(q);
  });
  const countEl = document.getElementById('request-inv-count');
  if (countEl) {
    countEl.textContent = requestSelectedInv.size
      ? `${requestSelectedInv.size} ${t('requestInvSelectedSuffix')}`
      : '';
  }
  if (!list.length) {
    el.innerHTML = `<p class="panel-desc">${t('requestInvEmpty')}</p>`;
    return;
  }
  el.innerHTML = list.map((inv) => {
    const bits = [];
    if (inv.sku) bits.push(escHtml(inv.sku));
    if (Number(inv.karat) > 0 && itemMetalType(inv) === 'gold') bits.push(`${inv.karat}K`);
    if (Number(inv.weightGrams) > 0) bits.push(`${inv.weightGrams}g`);
    const price = getItemDisplayPrice(inv);
    const checked = requestSelectedInv.has(inv.id) ? ' checked' : '';
    return `<label class="request-inv-row${checked ? ' is-selected' : ''}">
      <input type="checkbox" data-request-inv-tick="${escHtml(inv.id)}"${checked} />
      <span class="request-inv-name"><strong>${escHtml(inv.name)}</strong>
        <span class="request-item-meta">${bits.join(' · ')}</span></span>
      <span class="request-inv-price">${price > 0 ? formatMoney(price) : '—'}</span>
    </label>`;
  }).join('');
  el.querySelectorAll('[data-request-inv-tick]').forEach((box) => {
    box.addEventListener('change', () => {
      const id = box.dataset.requestInvTick;
      if (box.checked) requestSelectedInv.add(id);
      else requestSelectedInv.delete(id);
      box.closest('.request-inv-row')?.classList.toggle('is-selected', box.checked);
      const countEl2 = document.getElementById('request-inv-count');
      if (countEl2) {
        countEl2.textContent = requestSelectedInv.size
          ? `${requestSelectedInv.size} ${t('requestInvSelectedSuffix')}`
          : '';
      }
    });
  });
}

document.querySelectorAll('[data-request-mode]').forEach((btn) => {
  btn.addEventListener('click', () => setRequestItemMode(btn.dataset.requestMode));
});

document.getElementById('request-inv-search')?.addEventListener('input', (e) => {
  requestInvFilter = e.target.value || '';
  renderRequestInvList();
});
