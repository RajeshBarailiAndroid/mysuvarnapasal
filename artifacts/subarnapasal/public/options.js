(function () {
  'use strict';

  const TOLA_GRAMS = 11.664;
  let optionsCache = [];
  let currentFilter = 'all';
  let searchTerm = '';
  let expandedId = null;
  let editingId = null;
  let payModalOptId = null; // record whose payment dialog is open
  let editingPayId = null;  // payment entry being edited in the dialog
  let payModalHistoryOnly = false; // true = history view (no pay form)

  // Old records used taken/given/kept; the tab now uses credit/borrow/deposit.
  // Old values keep working and are shown under their new category.
  function normalizeType(t) {
    if (t === 'given' || t === 'credit') return 'credit';
    if (t === 'taken' || t === 'borrow') return 'borrow';
    if (t === 'kept' || t === 'deposit') return 'deposit';
    return 'credit';
  }

  // Asset kind of a record: cash | gold | silver | other. Older records have
  // no explicit field — infer from weight/karat.
  function metalOf(o) {
    if (o.metal === 'cash' || o.metal === 'gold' || o.metal === 'silver' || o.metal === 'other') return o.metal;
    if (!o.weightGrams || o.weightGrams === 0) return 'cash';
    return (o.karat === 999 || o.karat === 925) ? 'silver' : 'gold';
  }

  const KARAT_OPTIONS = {
    gold: [['24', '24K'], ['22', '22K'], ['18', '18K'], ['14', '14K']],
    silver: [['999', '999 (fine)'], ['925', '925 (sterling)']]
  };


  // ── Formatters ──────────────────────────────────────────────────────────────

  function fmtNPR(n) {
    return 'NPR\u00a0' + Number(n || 0).toLocaleString('en-IN');
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-NP', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (_) { return d; }
  }

  function typeInfo(t) {
    const n = normalizeType(t);
    if (n === 'credit')  return { label: 'Credit',  bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' };
    if (n === 'borrow')  return { label: 'Borrow',  bg: '#ede9fe', fg: '#4c1d95', border: '#7c3aed' };
    if (n === 'deposit') return { label: 'Deposit', bg: '#d1fae5', fg: '#064e3b', border: '#059669' };
    return { label: t, bg: '#f3f4f6', fg: '#374151', border: '#9ca3af' };
  }

  function totalPaid(opt) {
    return (opt.payments || []).reduce(function (s, p) { return s + (p.amount || 0); }, 0);
  }

  function remaining(opt) {
    return Math.max(0, (opt.cost || 0) - totalPaid(opt));
  }

  // ── API helpers ─────────────────────────────────────────────────────────────

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    // Attach the signed-in user's token, same as the rest of the app.
    if (typeof getAuthAccessToken === 'function') {
      try {
        const token = await getAuthAccessToken();
        if (token) opts.headers.Authorization = 'Bearer ' + token;
      } catch (_) { /* not signed in — let the server decide */ }
    }
    const res = await fetch('/api' + path, opts);
    if (res.status === 401 && typeof redirectToLogin === 'function') {
      redirectToLogin();
    }
    if (!res.ok) {
      const err = await res.json().catch(function () { return { error: res.statusText }; });
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  async function loadOptions() {
    const wrap = document.getElementById('options-table');
    if (wrap) wrap.innerHTML = '<div class="table-empty"><span class="spinner"></span> Loading…</div>';
    try {
      optionsCache = await api('GET', '/options');
    } catch (e) {
      if (wrap) wrap.innerHTML = '<div class="table-empty" style="color:var(--danger)">' + escHtml(e.message) + '</div>';
      return;
    }
    renderOptionsUI();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  function renderOptionsUI() {
    const term = searchTerm.toLowerCase().trim();
    let filtered = currentFilter === 'all'
      ? optionsCache
      : optionsCache.filter(function (o) { return normalizeType(o.type) === currentFilter; });
    if (term) {
      filtered = filtered.filter(function (o) {
        return (o.name || '').toLowerCase().includes(term);
      });
    }
    renderStats(optionsCache);
    renderTable(filtered, term);
    updateFilterTabs();
  }

  function renderStats(options) {
    const el = document.getElementById('options-stats');
    if (!el) return;
    const stats = {
      credit:  { count: 0, cost: 0, paid: 0 },
      borrow:  { count: 0, cost: 0, paid: 0 },
      deposit: { count: 0, cost: 0, paid: 0 }
    };
    for (const o of options) {
      const t = normalizeType(o.type);
      stats[t].count += 1;
      stats[t].cost += (o.cost || 0);
      stats[t].paid += totalPaid(o);
    }
    el.innerHTML = ['credit', 'borrow', 'deposit'].map(function (type) {
      const s = stats[type];
      const info = typeInfo(type);
      const rem = Math.max(0, s.cost - s.paid);
      return '<div class="options-stat-card" style="border-left:4px solid ' + info.border + '">'
        + '<span class="opt-type-badge" style="background:' + info.bg + ';color:' + info.fg + ';border:1px solid ' + info.border + '">' + info.label + '</span>'
        + '<div class="opt-stat-num">' + s.count + '</div>'
        + '<div class="opt-stat-lbl">records</div>'
        + '<div class="opt-stat-amt">' + fmtNPR(s.cost) + '</div>'
        + '<div class="opt-stat-rem" style="color:' + (rem > 0 ? 'var(--danger,#dc2626)' : 'var(--success,#059669)') + '">'
          + (rem > 0 ? 'Remaining: ' + fmtNPR(rem) : '✓ All cleared') + '</div>'
        + '</div>';
    }).join('');
  }

  function updateFilterTabs() {
    document.querySelectorAll('[data-options-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.optionsTab === currentFilter);
    });
  }

  function renderTable(options, term) {
    const el = document.getElementById('options-table');
    if (!el) return;
    if (options.length === 0) {
      el.innerHTML = (term
        ? '<div class="table-empty"><p>No records match <strong>"' + escHtml(term) + '"</strong>.</p></div>'
        : '<div class="table-empty"><p>No records yet. Click <strong>+ Add Record</strong> to start.</p></div>');
      return;
    }
    let rows = '';
    for (const opt of options) {
      rows += buildRow(opt);
    }
    el.innerHTML = '<div class="table-responsive"><table class="data-table options-table">'
      + '<thead><tr>'
      + '<th>Type</th><th>Name</th><th>Item</th><th>Weight</th>'
      + '<th>Rate/Tola</th><th>Cost</th><th>Date</th><th>Committed</th>'
      + '<th>Remaining</th><th style="text-align:right">Actions</th>'
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table></div>';
  }

  function buildRow(opt) {
    const info = typeInfo(opt.type);
    const paid = totalPaid(opt);
    const rem = remaining(opt);
    const isExpanded = expandedId === opt.id;
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = opt.committedDate && opt.committedDate < today && opt.status !== 'closed';

    const typeBadge = '<span class="opt-type-badge" style="background:' + info.bg + ';color:' + info.fg + ';border:1px solid ' + info.border + '">' + info.label + '</span>';

    const dueDateCell = opt.committedDate
      ? (isOverdue
        ? '<span style="color:var(--danger,#dc2626);font-weight:600">' + fmtDate(opt.committedDate) + '</span><br><span style="font-size:0.7rem;color:var(--danger,#dc2626)">Overdue</span>'
        : fmtDate(opt.committedDate))
      : '—';


    const remCell = rem > 0
      ? '<span style="color:var(--danger,#dc2626);font-weight:700">' + fmtNPR(rem) + '</span>'
      : '<span style="color:var(--success,#059669);font-weight:600">✓ Clear</span>';

    const actions = '<div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">'
      + '<button class="btn btn-sm btn-gold pay-opt-btn" data-opt-id="' + escHtml(opt.id) + '" title="Record a payment" style="padding:3px 10px;font-size:0.75rem">💰 Pay</button>'
      + '<button class="btn btn-sm btn-outline hist-opt-btn" data-opt-id="' + escHtml(opt.id) + '" title="Payment history — all paid amounts and dates" style="padding:3px 8px;font-size:0.75rem">🕘</button>'
      + (opt.saleId
        ? '<span title="Created automatically from a credit sale" style="font-size:0.68rem;color:var(--muted);align-self:center;white-space:nowrap">🧾 ' + escHtml(opt.invoiceNumber || 'invoice') + '</span>'
        : '<button class="btn btn-sm btn-outline edit-opt-btn" data-opt-id="' + escHtml(opt.id) + '" title="Edit record">✏️</button>')
      + '<button class="btn btn-sm del-opt-btn" data-opt-id="' + escHtml(opt.id) + '" title="Delete record" style="background:var(--danger-light,#fee2e2);color:var(--danger,#dc2626);border:1px solid #fca5a5">🗑</button>'
      + '</div>';

    const rowClass = 'options-row' + (isOverdue ? ' options-row-overdue' : '');

    const metal = metalOf(opt);
    let weightCell;
    if (metal === 'cash') {
      weightCell = '<span class="opt-money-tag">Cash / Money</span>';
    } else if (!opt.weightGrams) {
      weightCell = '<span class="opt-money-tag">' + (metal === 'other' ? 'Other' : metal.charAt(0).toUpperCase() + metal.slice(1)) + '</span>';
    } else {
      const detail = metal === 'gold' ? (opt.weightGrams / TOLA_GRAMS).toFixed(3) + 't' + (opt.karat ? ' · ' + escHtml(opt.karat) + 'K' : '')
        : metal === 'silver' ? (opt.weightGrams / TOLA_GRAMS).toFixed(3) + 't · Silver ' + (opt.karat === 925 ? '925' : '999')
        : 'Other';
      weightCell = '<strong>' + escHtml(opt.weightGrams) + 'g</strong><br><span class="opt-sub">' + detail + '</span>';
    }
    const rateCell = (metal === 'cash' || !opt.rate) ? '—' : 'NPR\u00a0' + Number(opt.rate || 0).toLocaleString('en-IN');

    return '<tr class="' + rowClass + '" data-opt-id="' + escHtml(opt.id) + '">'
      + '<td>' + typeBadge + '</td>'
      + '<td><strong>' + escHtml(opt.name) + '</strong>'
        + (opt.notes ? '<br><span class="opt-note">' + escHtml(opt.notes) + '</span>' : '') + '</td>'
      + '<td>' + (opt.item ? escHtml(opt.item) : '—') + '</td>'
      + '<td style="white-space:nowrap">' + weightCell + '</td>'
      + '<td>' + rateCell + '</td>'
      + '<td style="font-weight:700">NPR ' + Number(opt.cost || 0).toLocaleString('en-IN') + '</td>'
      + '<td style="white-space:nowrap">' + fmtDate(opt.date) + '</td>'
      + '<td style="white-space:nowrap">' + dueDateCell + '</td>'
      + '<td>' + remCell + '</td>'
      + '<td>' + actions + '</td>'
      + '</tr>';
  }

  function buildPaymentPanel(opt) {
    const payments = opt.payments || [];
    const paid = totalPaid(opt);
    const rem = remaining(opt);
    const today = new Date().toISOString().slice(0, 10);

    let histHtml = '';
    if (payments.length === 0) {
      histHtml = '<p style="color:var(--muted);font-size:0.85rem;margin:0 0 0.75rem">No payments recorded yet.</p>';
    } else {
      histHtml = '<table class="opt-pay-table"><thead><tr>'
        + '<th>Date</th><th>Amount</th><th>Note</th><th></th>'
        + '</tr></thead><tbody>';
      payments.forEach(function (p, i) {
        histHtml += '<tr style="background:' + (i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)') + '">'
          + '<td>' + fmtDate(p.date) + '</td>'
          + '<td><strong>' + fmtNPR(p.amount) + '</strong></td>'
          + '<td style="color:var(--muted)">' + (p.note ? escHtml(p.note) : '—') + '</td>'
          + '<td>' + (opt.saleId ? '' : '<button class="btn btn-sm del-pay-btn" data-opt-id="' + escHtml(opt.id) + '" data-pay-id="' + escHtml(p.id) + '" style="background:var(--danger-light,#fee2e2);color:var(--danger,#dc2626);border:1px solid #fca5a5;padding:2px 6px;font-size:0.72rem">Remove</button>') + '</td>'
          + '</tr>';
      });
      histHtml += '</tbody></table>';
    }

    return '<tr class="opt-pay-panel-row"><td colspan="11" style="padding:0">'
      + '<div class="opt-pay-panel">'
      + '<div class="opt-pay-panel-head">'
      + '<strong style="font-size:0.9rem">Payment History — ' + escHtml(opt.name) + '</strong>'
      + '<div class="opt-pay-summary">'
      + 'Total: <strong>NPR ' + Number(opt.cost || 0).toLocaleString('en-IN') + '</strong>'
      + '&nbsp;·&nbsp;Paid: <strong style="color:var(--success,#059669)">NPR ' + paid.toLocaleString('en-IN') + '</strong>'
      + '&nbsp;·&nbsp;Remaining: <strong style="color:' + (rem > 0 ? 'var(--danger,#dc2626)' : 'var(--success,#059669)') + '">NPR ' + rem.toLocaleString('en-IN') + '</strong>'
      + '</div>'
      + '</div>'
      + histHtml
      + (opt.saleId
        ? '<p style="color:var(--muted);font-size:0.8rem;margin:0">This entry is linked to invoice <strong>' + escHtml(opt.invoiceNumber || '') + '</strong>. Receive payments in <strong>Reports → Invoices</strong> — they appear here automatically.</p>'
        : '')
      + (opt.saleId ? '<form class="opt-add-pay-form" id="opt-pay-form-' + escHtml(opt.id) + '" style="display:none">' : '<form class="opt-add-pay-form" id="opt-pay-form-' + escHtml(opt.id) + '">')
      + '<input type="hidden" name="optId" value="' + escHtml(opt.id) + '">'
      + '<div class="opt-add-pay-fields">'
      + '<label class="opt-pay-label">Amount (NPR)<input type="number" name="amount" class="input" min="1" placeholder="' + (rem > 0 ? rem : '0') + '" required></label>'
      + '<label class="opt-pay-label">Date<input type="date" name="date" class="input" value="' + today + '"></label>'
      + '<label class="opt-pay-label" style="flex:2">Note (optional)<input type="text" name="note" class="input" placeholder="Cash · Bank transfer…"></label>'
      + '<button type="submit" class="btn btn-gold btn-sm" style="align-self:flex-end;margin-bottom:0">+ Add Payment</button>'
      + '</div>'
      + '</form>'
      + '</div>'
      + '</td></tr>';
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Event delegation on table ────────────────────────────────────────────────

  function bindTableEvents() {
    const wrap = document.getElementById('options-table');
    if (!wrap) return;
    wrap.addEventListener('click', async function (e) {
      const payBtn    = e.target.closest('.pay-opt-btn');
      const histBtn   = e.target.closest('.hist-opt-btn');
      const editBtn   = e.target.closest('.edit-opt-btn');
      const delBtn    = e.target.closest('.del-opt-btn');
      const delPayBtn = e.target.closest('.del-pay-btn');

      if (payBtn || histBtn) {
        const btn = payBtn || histBtn;
        const opt = optionsCache.find(function (o) { return o.id === btn.dataset.optId; });
        if (opt) openPayModal(opt, !!histBtn);
        return;
      }
      if (editBtn) {
        const id = editBtn.dataset.optId;
        const opt = optionsCache.find(function (o) { return o.id === id; });
        if (opt) openOptionModal(opt);
        return;
      }
      if (delBtn) {
        const id = delBtn.dataset.optId;
        if (!confirm('Delete this record? This cannot be undone.')) return;
        try {
          await api('DELETE', '/options/' + id);
          optionsCache = optionsCache.filter(function (o) { return o.id !== id; });
          if (expandedId === id) expandedId = null;
          renderOptionsUI();
        } catch (err) { alert(err.message); }
        return;
      }
      if (delPayBtn) {
        const optId = delPayBtn.dataset.optId;
        const payId = delPayBtn.dataset.payId;
        if (!confirm('Remove this payment entry?')) return;
        try {
          await api('DELETE', '/options/' + optId + '/payments/' + payId);
          const opt = optionsCache.find(function (o) { return o.id === optId; });
          if (opt) opt.payments = (opt.payments || []).filter(function (p) { return p.id !== payId; });
          renderOptionsUI();
        } catch (err) { alert(err.message); }
        return;
      }
    });

    wrap.addEventListener('submit', async function (e) {
      if (!e.target.classList.contains('opt-add-pay-form')) return;
      e.preventDefault();
      const form = e.target;
      const optId  = form.elements.optId.value;
      const amount = parseFloat(form.elements.amount.value) || 0;
      const date   = form.elements.date.value;
      const note   = form.elements.note.value.trim();
      if (amount <= 0) { alert('Enter a valid amount.'); return; }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const res = await api('POST', '/options/' + optId + '/payments', { amount, date, note });
        const opt = optionsCache.find(function (o) { return o.id === optId; });
        if (opt) opt.payments = res.option.payments;
        renderOptionsUI();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  }

  // ── Payment history dialog ───────────────────────────────────────────────────

  function openPayModal(opt, historyOnly) {
    payModalOptId = opt.id;
    editingPayId = null;
    payModalHistoryOnly = !!historyOnly;
    renderPayModal();
    applyNepaliInputLang();
    const modal = document.getElementById('opt-pay-modal');
    if (modal) modal.showModal();
  }

  function renderPayModal() {
    const opt = optionsCache.find(function (o) { return o.id === payModalOptId; });
    if (!opt) return;
    const linked = !!opt.saleId;
    const paid = totalPaid(opt);
    const rem = remaining(opt);
    const info = typeInfo(opt.type);

    const title = document.getElementById('opt-pay-title');
    if (title) {
      title.textContent = (payModalHistoryOnly ? 'Payment history — ' : info.label + ' — ')
        + (opt.name || '') + (opt.invoiceNumber ? ' (' + opt.invoiceNumber + ')' : '');
    }

    const summary = document.getElementById('opt-pay-summary');
    if (summary) {
      // Linked records carry the complete checkout information: the summary
      // shows the SALE total and the paid amount (at checkout + receipts),
      // e.g. Total 337,705 · Paid 100,000 · Remaining credit 237,705.
      const hasSale = opt.saleTotal != null && opt.saleTotal > 0;
      const grandTotal = hasSale ? opt.saleTotal : (opt.cost || 0);
      const paidTotal = hasSale ? (opt.salePaid || 0) + paid : paid;
      let html = '';
      if (linked || opt.creditFor || (opt.saleLines || []).length) {
        const lines = opt.saleLines || [];
        const lineDetails = lines.map(function (l) {
          let p = '<strong>' + escHtml(l.name || 'Item') + '</strong>';
          if ((l.quantity || 1) > 1) p += ' ×' + l.quantity;
          if (l.weightGrams > 0) p += ' · ' + l.weightGrams + 'g' + (l.karat ? ' ' + escHtml(l.karat) + 'K' : '');
          if (l.lineTotal > 0) p += ' · ' + fmtNPR(l.lineTotal);
          return p;
        }).join('<br>');
        html += '<div style="flex-basis:100%;background:#faf7f0;border:1px solid #ece5d3;border-radius:8px;padding:9px 12px;font-size:0.85rem;line-height:1.6">'
          + '<div>Person: <strong>' + escHtml(opt.name || '') + '</strong>'
          + (opt.customerPhone ? ' · ' + escHtml(opt.customerPhone) : '')
          + (opt.invoiceNumber ? ' &nbsp;·&nbsp; Invoice: <strong>' + escHtml(opt.invoiceNumber) + '</strong>' : '')
          + ' &nbsp;·&nbsp; ' + fmtDate(opt.date) + '</div>'
          + '<div>Credit for: <strong>' + escHtml(opt.creditFor || opt.item || 'Cash') + '</strong></div>'
          + (lineDetails ? '<div style="margin-top:3px;color:#555">' + lineDetails + '</div>' : '')
          + '</div>';
      }
      html +=
        '<span>Total: <strong>' + fmtNPR(grandTotal) + '</strong></span>'
        + (hasSale ? '<span>Paid at checkout: <strong style="color:var(--success,#059669)">' + fmtNPR(opt.salePaid || 0) + '</strong></span>' : '')
        + '<span>Paid ' + (hasSale ? 'since' : '') + ': <strong style="color:var(--success,#059669)">' + fmtNPR(paid) + '</strong></span>'
        + '<span>Remaining credit: <strong style="color:' + (rem > 0 ? 'var(--danger,#dc2626)' : 'var(--success,#059669)') + '">'
        + (rem > 0 ? fmtNPR(rem) : '✓ Clear') + '</strong></span>';
      summary.innerHTML = html;
    }

    const hist = document.getElementById('opt-pay-history');
    if (hist) {
      const payments = opt.payments || [];
      if (payments.length === 0) {
        hist.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;margin:0">No payments recorded yet.</p>';
      } else {
        let rows = '';
        payments.forEach(function (p, i) {
          rows += '<tr style="background:' + (i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)') + '">'
            + '<td style="white-space:nowrap">' + fmtDate(p.date) + '</td>'
            + '<td><strong>' + fmtNPR(p.amount) + '</strong></td>'
            + '<td style="color:var(--muted)">' + (p.note ? escHtml(p.note) : '—') + '</td>'
            + '<td style="text-align:right;white-space:nowrap">'
            + (linked ? '' :
              '<button type="button" class="btn btn-sm btn-outline pay-edit-btn" data-pay-id="' + escHtml(p.id) + '" title="Edit payment" style="padding:2px 8px;font-size:0.72rem">✏️ Edit</button> '
              + '<button type="button" class="btn btn-sm pay-del-btn" data-pay-id="' + escHtml(p.id) + '" title="Delete payment" style="background:var(--danger-light,#fee2e2);color:var(--danger,#dc2626);border:1px solid #fca5a5;padding:2px 8px;font-size:0.72rem">🗑</button>')
            + '</td></tr>';
        });
        hist.innerHTML = '<table class="opt-pay-table" style="width:100%"><thead><tr>'
          + '<th>Date</th><th>Amount</th><th>Note</th><th></th>'
          + '</tr></thead><tbody>' + rows + '</tbody></table>';
      }
    }

    const form = document.getElementById('opt-pay-modal-form');
    const hint = document.getElementById('opt-pay-linked-hint');
    if (form) form.style.display = payModalHistoryOnly ? 'none' : '';
    if (hint) {
      hint.style.display = (linked && !payModalHistoryOnly) ? '' : 'none';
      hint.innerHTML = linked
        ? 'Payments recorded here are saved on invoice <strong>' + escHtml(opt.invoiceNumber || '') + '</strong> — the same receipt also shows in Reports → Invoices.'
        : '';
    }
    if (form && form.elements && !editingPayId) {
      form.elements.amount.value = '';
      form.elements.amount.placeholder = rem > 0 ? String(rem) : '0';
      form.elements.date.value = new Date().toISOString().slice(0, 10);
      form.elements.note.value = '';
      const submitBtn = document.getElementById('opt-pay-submit');
      if (submitBtn) submitBtn.textContent = 'Done';
      const cancelBtn = document.getElementById('opt-pay-cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
    }
  }

  function startPayEdit(payId) {
    const opt = optionsCache.find(function (o) { return o.id === payModalOptId; });
    if (!opt) return;
    const p = (opt.payments || []).find(function (x) { return x.id === payId; });
    if (!p) return;
    editingPayId = payId;
    payModalHistoryOnly = false; // editing needs the form visible
    renderPayModal();
    const form = document.getElementById('opt-pay-modal-form');
    if (!form || !form.elements) return;
    form.elements.amount.value = p.amount;
    form.elements.date.value = p.date || '';
    form.elements.note.value = p.note || '';
    const submitBtn = document.getElementById('opt-pay-submit');
    if (submitBtn) submitBtn.textContent = 'Done';
    const cancelBtn = document.getElementById('opt-pay-cancel-edit');
    if (cancelBtn) cancelBtn.style.display = '';
    form.elements.amount.focus();
  }

  function bindPayModalEvents() {
    const modal = document.getElementById('opt-pay-modal');
    const form = document.getElementById('opt-pay-modal-form');
    const hist = document.getElementById('opt-pay-history');
    if (!modal || !form || !hist) return;

    const closeBtn = document.getElementById('close-opt-pay-modal');
    if (closeBtn) closeBtn.addEventListener('click', function () { modal.close(); });
    modal.addEventListener('close', function () { payModalOptId = null; editingPayId = null; });

    const cancelBtn = document.getElementById('opt-pay-cancel-edit');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      editingPayId = null;
      renderPayModal();
    });

    // Live preview: type 1000 against a 2000 balance → "Remaining after this
    // payment: NPR 1,000".
    form.addEventListener('input', function (e) {
      if (!e.target || e.target.name !== 'amount') return;
      const hint = document.getElementById('opt-pay-live-hint');
      const opt = optionsCache.find(function (o) { return o.id === payModalOptId; });
      if (!hint || !opt) return;
      const amount = parseFloat(form.elements.amount.value) || 0;
      if (amount <= 0) { hint.textContent = ''; return; }
      // When editing an entry, its current amount comes back before the new one counts.
      let base = remaining(opt);
      if (editingPayId) {
        const editing = (opt.payments || []).find(function (p) { return p.id === editingPayId; });
        if (editing) base += (editing.amount || 0);
      }
      const after = base - amount;
      if (after >= 0) {
        hint.style.color = after === 0 ? 'var(--success,#059669)' : 'var(--danger,#dc2626)';
        hint.textContent = after === 0
          ? '✓ This payment clears the full balance.'
          : 'Remaining after this payment: ' + fmtNPR(after);
      } else {
        hint.style.color = 'var(--danger,#dc2626)';
        hint.textContent = 'This is ' + fmtNPR(-after) + ' MORE than the remaining balance.';
      }
    });

    hist.addEventListener('click', async function (e) {
      const editBtn = e.target.closest('.pay-edit-btn');
      const delBtn = e.target.closest('.pay-del-btn');
      if (editBtn) { startPayEdit(editBtn.dataset.payId); return; }
      if (delBtn) {
        if (!confirm('Remove this payment entry?')) return;
        try {
          await api('DELETE', '/options/' + payModalOptId + '/payments/' + delBtn.dataset.payId);
          const opt = optionsCache.find(function (o) { return o.id === payModalOptId; });
          if (opt) opt.payments = (opt.payments || []).filter(function (p) { return p.id !== delBtn.dataset.payId; });
          if (editingPayId === delBtn.dataset.payId) editingPayId = null;
          renderOptionsUI();
          renderPayModal();
        } catch (err) { alert(err.message); }
      }
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const opt = optionsCache.find(function (o) { return o.id === payModalOptId; });
      if (!opt) return;
      const amount = parseFloat(form.elements.amount.value) || 0;
      const date = form.elements.date.value;
      const note = form.elements.note.value.trim();
      if (amount <= 0) { alert('Enter a valid amount.'); return; }
      if (opt.saleId && amount > remaining(opt)) {
        alert('The amount is more than the remaining ' + fmtNPR(remaining(opt)) + '.');
        return;
      }
      if (!opt.saleId && !editingPayId && amount > remaining(opt)) {
        if (!confirm('This payment is more than the remaining ' + fmtNPR(remaining(opt)) + '. Record it anyway?')) return;
      }
      const btn = document.getElementById('opt-pay-submit');
      if (btn) btn.disabled = true;
      try {
        if (opt.saleId) {
          // Linked to an invoice: record the receipt on the sale — the
          // backend mirrors it onto this record automatically.
          await api('POST', '/sales/' + opt.saleId + '/payments', { amount, date, note });
          await loadOptions(); // pull the mirrored payment into the record
        } else {
          const res = editingPayId
            ? await api('PUT', '/options/' + opt.id + '/payments/' + editingPayId, { amount, date, note })
            : await api('POST', '/options/' + opt.id + '/payments', { amount, date, note });
          opt.payments = res.option.payments;
          renderOptionsUI();
        }
        editingPayId = null;
        // Done: save and dismiss the popup.
        modal.close();
      } catch (err) {
        alert(err.message);
      }
      if (btn) btn.disabled = false;
    });
  }

  // ── Option modal ─────────────────────────────────────────────────────────────

  function openOptionModal(opt) {
    editingId = opt ? opt.id : null;
    const modal = document.getElementById('option-modal');
    const form  = document.getElementById('option-form');
    if (!modal || !form) return;
    form.reset();
    delete form.elements.cost.dataset.manualEdit;
    document.getElementById('option-modal-title').textContent = opt ? 'Edit Record' : 'New Record';
    if (opt) {
      form.elements.type.value    = normalizeType(opt.type);
      form.elements.metal.value   = metalOf(opt);
      form.elements.name.value    = opt.name || '';
      form.elements['item'].value  = opt.item || '';
      form.elements['weight-grams'].value = opt.weightGrams || '';
      form.elements.rate.value    = opt.rate || '';
      form.elements.cost.value    = opt.cost || '';
      form.elements.date.value    = opt.date || '';
      form.elements['committed-date'].value = opt.committedDate || '';
      form.elements.notes.value   = opt.notes || '';
      applyMetalFields(form);
      form.elements.karat.value   = String(opt.karat || 22);
    } else {
      form.elements.metal.value = 'cash';
      form.elements.date.value = new Date().toISOString().slice(0, 10);
      applyMetalFields(form);
    }
    recalcCost(form);
    applyNepaliInputLang();
    modal.showModal();
  }

  // Show/hide weight, karat and rate depending on the chosen asset kind.
  function applyMetalFields(form) {
    const metal = form.elements.metal.value;
    const show = function (id, on) {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? '' : 'none';
    };
    show('opt-field-weight', metal !== 'cash');
    show('opt-field-karat', metal === 'gold' || metal === 'silver');
    show('opt-field-rate', metal === 'gold' || metal === 'silver');
    const karatSel = document.getElementById('opt-karat-select');
    const karatLbl = document.getElementById('opt-karat-label');
    if (karatSel && (metal === 'gold' || metal === 'silver')) {
      const current = karatSel.value;
      karatSel.innerHTML = KARAT_OPTIONS[metal].map(function (o) {
        return '<option value="' + o[0] + '">' + o[1] + '</option>';
      }).join('');
      const values = KARAT_OPTIONS[metal].map(function (o) { return o[0]; });
      karatSel.value = values.indexOf(current) !== -1 ? current : values[metal === 'gold' ? 1 : 0];
      if (karatLbl) karatLbl.textContent = metal === 'gold' ? 'Karat' : 'Purity';
    }
    if (metal === 'gold' && !form.elements.rate.value
        && typeof goldRateCache !== 'undefined' && goldRateCache > 0) {
      form.elements.rate.value = Math.round(goldRateCache);
    }
    if (metal === 'cash') {
      form.elements['weight-grams'].value = '';
      form.elements.rate.value = '';
    }
  }

  function recalcCost(form) {
    if (form.elements.cost.dataset.manualEdit) return;
    const metal = form.elements.metal ? form.elements.metal.value : '';
    if (metal !== 'gold' && metal !== 'silver') return;
    const wg   = parseFloat(form.elements['weight-grams'].value) || 0;
    const rate = parseFloat(form.elements.rate.value) || 0;
    if (wg > 0 && rate > 0) {
      form.elements.cost.value = Math.round((wg / TOLA_GRAMS) * rate);
    }
  }

  function bindModalEvents() {
    const modal = document.getElementById('option-modal');
    const form  = document.getElementById('option-form');
    if (!modal || !form) return;

    document.getElementById('close-option-modal').addEventListener('click', function () { modal.close(); });
    document.getElementById('cancel-option-modal').addEventListener('click', function () { modal.close(); });

    form.addEventListener('input', function (e) {
      const name = e.target.name;
      if (name === 'weight-grams' || name === 'rate') {
        delete form.elements.cost.dataset.manualEdit;
        recalcCost(form);
      }
      if (name === 'cost') {
        form.elements.cost.dataset.manualEdit = '1';
      }
    });

    form.addEventListener('change', function (e) {
      if (e.target.name === 'metal') {
        applyMetalFields(form);
        delete form.elements.cost.dataset.manualEdit;
        recalcCost(form);
      }
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const metal = form.elements.metal.value;
      const data = {
        type:          form.elements.type.value,
        metal:         metal,
        name:          form.elements.name.value.trim(),
        item:          (form.elements['item'].value || '').trim(),
        weightGrams:   metal === 'cash' ? 0 : (parseFloat(form.elements['weight-grams'].value) || 0),
        karat:         metal === 'cash' || metal === 'other' ? 0 : (parseInt(form.elements.karat.value) || 22),
        rate:          metal === 'cash' ? 0 : (parseFloat(form.elements.rate.value) || 0),
        cost:          parseFloat(form.elements.cost.value) || 0,
        date:          form.elements.date.value,
        committedDate: form.elements['committed-date'].value,
        notes:         form.elements.notes.value.trim()
      };
      if (!data.name) { alert('Name is required.'); return; }
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        if (editingId) {
          const updated = await api('PUT', '/options/' + editingId, data);
          const idx = optionsCache.findIndex(function (o) { return o.id === editingId; });
          if (idx !== -1) {
            optionsCache[idx] = Object.assign({}, optionsCache[idx], updated);
          }
        } else {
          const created = await api('POST', '/options', data);
          optionsCache.unshift(created);
        }
        modal.close();
        renderOptionsUI();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  }

  // ── Filter tabs ──────────────────────────────────────────────────────────────

  function bindFilterTabs() {
    document.querySelectorAll('[data-options-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentFilter = btn.dataset.optionsTab;
        expandedId = null;
        renderOptionsUI();
      });
    });
  }

  // ── Nav hook — reload on every visit ─────────────────────────────────────────

  function bindNavHook() {
    document.querySelectorAll('[data-view="options"]').forEach(function (btn) {
      btn.addEventListener('click', loadOptions);
    });
  }

  // ── Add Option button ────────────────────────────────────────────────────────

  function bindAddBtn() {
    const btn = document.getElementById('add-option-btn');
    if (btn) btn.addEventListener('click', function () { openOptionModal(null); });
  }

  // ── Search input ─────────────────────────────────────────────────────────────

  function bindSearchInput() {
    const el = document.getElementById('options-search');
    if (!el) return;
    el.addEventListener('input', function () {
      searchTerm = el.value;
      expandedId = null;
      renderOptionsUI();
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  // When the app language is Nepali, tag the Records text inputs lang="ne"
  // so Nepali IMEs / keyboards engage for typing names and notes here too.
  function applyNepaliInputLang() {
    let ne = false;
    try { ne = (localStorage.getItem('subarnapasal.lang') || 'en') === 'ne'; } catch (_) {}
    const selector = '#options-search, #option-form input[type="text"], #option-form textarea, '
      + '#opt-pay-modal-form input[type="text"]';
    document.querySelectorAll(selector).forEach(function (el) {
      if (ne) { el.setAttribute('lang', 'ne'); el.setAttribute('spellcheck', 'false'); }
      else el.removeAttribute('lang');
    });
  }
  window.applyNepaliInputLang = applyNepaliInputLang;

  document.addEventListener('DOMContentLoaded', function () {
    bindTableEvents();
    bindModalEvents();
    bindPayModalEvents();
    bindFilterTabs();
    bindNavHook();
    bindAddBtn();
    bindSearchInput();
    applyNepaliInputLang();
  });

  window.reloadOptions = loadOptions;
})();
