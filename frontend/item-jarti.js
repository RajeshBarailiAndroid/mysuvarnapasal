// item-jarti.js — jarti-by-weight entry, live Rate/Amount display, and a
// simplified "Add item" form (Purity · Weight · Rate · Amount · Making · Stone).
// Editing an existing item still shows every field.

/* eslint-disable no-undef */

(function initItemJarti() {
  const form = document.getElementById('item-form');
  if (!form) return;

  const TOLA = 11.664;

  const LABELS = {
    grams: 'Jarti weight (grams) / जर्ती तौल',
    percent: 'Jarti percent (%)',
    flat: 'Jarti amount (रू)',
    per_gram: 'Jarti rate per gram',
    per_tola: 'Jarti rate per tola',
  };

  // Fields hidden when ADDING a new item (kept for editing).
  const ADVANCED_FIELDS = [
    'location', 'purchaseCost', 'status', 'salePrice', 'notes',
    'hsCode', 'hallmarkNumber', 'hallmarkDate', 'hallmark', 'quantity',
    'jartiRateType', 'jartiRateValue',
  ];

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function formWeightGrams() {
    try {
      if (typeof getWeightGramsFromForm === 'function') {
        return num(getWeightGramsFromForm(form, ''));
      }
    } catch (_) { /* fall through */ }
    return num(form.weightGrams?.value);
  }

  function metalRatePerTola() {
    const category = String(form.category?.value || 'gold').toLowerCase();
    if (category === 'silver') return typeof silverRateCache !== 'undefined' ? num(silverRateCache) : 0;
    if (category === 'other') return num(form.customRatePerTola?.value);
    const sel = document.getElementById('item-rate-select');
    const chosen = sel ? num(sel.value) : 0;
    if (chosen > 0) return chosen;
    return typeof goldRateCache !== 'undefined' ? num(goldRateCache) : 0;
  }

  function karatFactor() {
    const category = String(form.category?.value || 'gold').toLowerCase();
    if (category === 'silver' || category === 'other') return 1;
    const k = num(form.karat?.value) || 24;
    return k / 24;
  }

  function jartiAmount(weightGrams, rate, kf, metalValue) {
    const type = String(form.jartiRateType?.value || 'flat');
    const value = num(form.jartiRateValue?.value);
    if (value <= 0) return { amount: 0, grams: 0 };
    let grams = 0;
    let amount = 0;
    if (typeof calcJartiAmount === 'function') {
      amount = calcJartiAmount({
        jartiRateType: type, jartiRateValue: value,
        weightGrams, metalValue, ratePerTola: rate, karatFactor: kf,
      });
      if (type === 'grams') grams = value;
      else if (type === 'percent') grams = weightGrams > 0 ? (weightGrams * value) / 100 : 0;
    } else {
      if (type === 'grams') { grams = value; amount = grams * (rate / TOLA) * kf; }
      else if (type === 'percent') { grams = (weightGrams * value) / 100; amount = grams * (rate / TOLA) * kf; }
      else if (type === 'per_gram') amount = value * weightGrams;
      else if (type === 'per_tola') amount = value * (weightGrams / TOLA);
      else amount = value;
    }
    return { amount, grams };
  }

  function money(v) {
    try {
      if (typeof formatMoney === 'function') return formatMoney(v);
    } catch (_) { /* fall through */ }
    return 'रू ' + Math.round(v).toLocaleString();
  }

  // ── Rate (per tola): select fed from the saved rates in Settings ──
  function ensureRateAmountFields() {
    if (!document.getElementById('item-rate-select')) {
      const makingLabel = form.makingCharge?.closest('label');
      if (makingLabel) {
        const rateLabel = document.createElement('label');
        rateLabel.innerHTML = '<span id="item-rate-label">Rate (per tola)</span><select id="item-rate-select"></select>';
        makingLabel.parentNode.insertBefore(rateLabel, makingLabel);
        rateLabel.querySelector('select').addEventListener('change', refresh);
      }
    }
    ensureWeightUnitRadios();
  }

  function rateDisplay(perTola) {
    const unit = weightUnitSelect()?.value === 'tola' ? 'tola' : 'grams';
    if (unit === 'tola') return `${money(perTola)} /tola`;
    return `${money(Math.round(perTola / TOLA))} /gram`;
  }

  function rebuildRateOptions() {
    const sel = document.getElementById('item-rate-select');
    if (!sel) return;
    if (document.activeElement === sel) return; // don't rebuild while the user is choosing
    const labelEl = document.getElementById('item-rate-label');
    if (labelEl) {
      labelEl.textContent = weightUnitSelect()?.value === 'tola' ? 'Rate (per tola)' : 'Rate (per gram)';
    }
    const category = String(form.category?.value || 'gold').toLowerCase();
    const settings = typeof settingsCache !== 'undefined' ? (settingsCache || {}) : {};
    const opts = [];
    if (category === 'silver') {
      const rate = typeof silverRateCache !== 'undefined' ? num(silverRateCache) : 0;
      opts.push({ v: rate, label: `Silver rate — ${rateDisplay(rate)}` });
    } else if (category === 'other') {
      const rate = num(form.customRatePerTola?.value);
      opts.push({ v: rate, label: rate > 0 ? `Item rate — ${rateDisplay(rate)}` : 'Set "rate per tola" above' });
    } else {
      const current = typeof goldRateCache !== 'undefined' ? num(goldRateCache) : 0;
      if (current > 0) opts.push({ v: current, label: `Today's gold rate — ${rateDisplay(current)}` });
      const buy = num(settings.goldBuyRatePerTola);
      if (buy > 0 && buy !== current) opts.push({ v: buy, label: `Gold buy rate — ${rateDisplay(buy)}` });
      const seen = new Set(opts.map((o) => Math.round(o.v)));
      (Array.isArray(settings.rateHistory) ? settings.rateHistory : []).slice(0, 25).forEach((h) => {
        const r = num(h && h.goldRatePerTola);
        if (r <= 0 || seen.has(Math.round(r))) return;
        seen.add(Math.round(r));
        opts.push({ v: r, label: `${String(h.date || '').slice(0, 10)} — ${rateDisplay(r)}` });
      });
      if (!opts.length) opts.push({ v: 0, label: 'Set the gold rate in Settings' });
    }
    const previous = sel.dataset.userPicked === '1' ? sel.value : null;
    sel.innerHTML = opts.slice(0, 12).map((o, i) =>
      `<option value="${escapeHtml(o.v)}"${i === 0 ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    if (previous && [...sel.options].some((o) => o.value === previous)) sel.value = previous;
    sel.disabled = category !== 'gold' && category !== '';
  }

  // ── Weight unit as radio buttons on top (Grams / Tola) ──
  function weightUnitSelect() {
    return form.querySelector('.weight-entry[data-weight-prefix=""] select[name="weightUnit"]')
      || form.querySelector('select[name="weightUnit"]');
  }

  function ensureWeightUnitRadios() {
    if (document.getElementById('item-weight-unit-radios')) return;
    const sel = weightUnitSelect();
    if (!sel) return;
    const wrap = sel.closest('label');
    if (!wrap) return;
    wrap.style.display = 'none'; // hide the old select + its label entirely
    const bar = document.createElement('div');
    bar.id = 'item-weight-unit-radios';
    bar.className = 'span-2';
    bar.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.15rem 0 .3rem';
    const mkBtn = (value, text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.unit = value;
      b.textContent = text;
      b.style.cssText = 'flex:1;padding:.5rem .8rem;border-radius:8px;border:2px solid #b8860b;'
        + 'background:#fff;color:#b8860b;font-weight:700;font-size:.85rem;cursor:pointer';
      b.addEventListener('click', () => {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        syncWeightUnitRadios();
      });
      return b;
    };
    const label = document.createElement('span');
    label.textContent = 'Weight unit:';
    label.style.cssText = 'font-size:.8rem;font-weight:600;opacity:.75;white-space:nowrap';
    bar.append(label, mkBtn('grams', 'Grams (ग्राम)'), mkBtn('tola', 'Tola / Laal'));
    wrap.parentNode.insertBefore(bar, wrap);
    syncWeightUnitRadios();
  }

  function syncWeightUnitRadios() {
    const sel = weightUnitSelect();
    const bar = document.getElementById('item-weight-unit-radios');
    if (!sel || !bar) return;
    bar.querySelectorAll('button[data-unit]').forEach((b) => {
      const active = b.dataset.unit === (sel.value === 'tola' ? 'tola' : 'grams');
      b.style.background = active ? '#b8860b' : '#fff';
      b.style.color = active ? '#fff' : '#b8860b';
    });
  }


  function refresh() {
    ensureRateAmountFields();
    const label = document.getElementById('item-jarti-value-label');
    const hint = document.getElementById('item-jarti-preview');
    const type = String(form.jartiRateType?.value || 'flat');
    if (label) label.textContent = LABELS[type] || 'Jarti rate value';

    const weightGrams = formWeightGrams();
    const rate = metalRatePerTola();
    const kf = karatFactor();
    const metalValue = (weightGrams / TOLA) * rate * kf;
    const { amount: jarti, grams } = jartiAmount(weightGrams, rate, kf, metalValue);
    const amount = Math.round(metalValue + jarti);

    rebuildRateOptions();
    const sel = document.getElementById('item-rate-select');
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.addEventListener('change', () => { sel.dataset.userPicked = '1'; });
    }
    // If a saved (older) rate is chosen for a gold item, lock the price in via sale price.
    const cat = String(form.category?.value || 'gold').toLowerCase();
    const currentGold = typeof goldRateCache !== 'undefined' ? num(goldRateCache) : 0;
    if (sel && cat === 'gold' && sel.dataset.userPicked === '1' && form.salePrice) {
      const chosen = num(sel.value);
      if (chosen > 0 && Math.round(chosen) !== Math.round(currentGold)) {
        const total = Math.round(metalValue + jarti) + num(form.makingCharge?.value);
        form.salePrice.value = total > 0 ? total : '';
      } else if (Math.round(chosen) === Math.round(currentGold)) {
        form.salePrice.value = '';
      }
    }
    syncWeightUnitRadios();

    const jartiHidden = form.jartiRateValue?.closest('label')?.hidden;
    if (hint && !jartiHidden) {
      if (jarti > 0) {
        const gramsNote = grams > 0 && type !== 'grams' ? ` (≈ ${grams.toFixed(3)} g)` : '';
        hint.textContent = `Jarti amount: ${money(jarti)}${gramsNote} — included in Amount and the calculated price.`;
        hint.hidden = false;
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }
    }
  }

  // ── Simple form for new items / full form when editing ──
  function setCompactMode(compact) {
    const hint = document.getElementById('item-jarti-preview');
    if (hint && compact) { hint.hidden = true; }
    ADVANCED_FIELDS.forEach((name) => {
      const field = form.elements[name];
      const el = field && (field.closest ? field : field[0]);
      const wrap = el && el.closest ? el.closest('label') : null;
      if (wrap) wrap.hidden = compact;
    });
  }

  function ensureMoreFieldsToggle() {
    if (document.getElementById('item-more-fields-btn')) return;
    const foot = form.querySelector('.modal-foot');
    if (!foot) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'item-more-fields-btn';
    btn.className = 'link-btn';
    btn.style.cssText = 'margin-right:auto;font-size:.8rem';
    btn.textContent = 'More fields ▾';
    btn.addEventListener('click', () => {
      const compact = btn.dataset.expanded === '1';
      setCompactMode(compact);
      btn.dataset.expanded = compact ? '' : '1';
      btn.textContent = compact ? 'More fields ▾' : 'Fewer fields ▴';
    });
    foot.insertBefore(btn, foot.firstChild);
  }

  if (typeof openItemModal === 'function') {
    const original = openItemModal;
    // eslint-disable-next-line no-global-assign
    openItemModal = function patchedOpenItemModal(item) {
      original(item);
      // restore the unit the item was added with
      const sel0 = weightUnitSelect();
      if (sel0 && item && item.weightUnit === 'tola' && sel0.value !== 'tola') {
        sel0.value = 'tola';
        sel0.dispatchEvent(new Event('change', { bubbles: true }));
      }
      ensureMoreFieldsToggle();
      setCompactMode(true); // Add AND Edit share the same simple layout
      const btn = document.getElementById('item-more-fields-btn');
      if (btn) { btn.dataset.expanded = ''; btn.textContent = 'More fields ▾'; }
      refresh();
    };
  }

  ['input', 'change'].forEach((evt) => form.addEventListener(evt, refresh));
  refresh();
})();
