// order-extras.js — New Order upgrades:
//  · weight-unit toggle buttons (Grams / Tola-Laal) like the Add Item form
//  · jarti entry in percent, grams, or laal
//  · clean payment section: tick "Advance received" or "Customer gave gold"
//    to reveal just those inputs — nothing else shown until needed
//  · customer gold credited at the metal rate; payable computed live

/* eslint-disable no-undef */

(function initOrderExtras() {
  const form = document.getElementById('order-form');
  if (!form) return;

  const TOLA = 11.664;
  const LAAL_G = TOLA / 100; // 1 tola = 100 laal

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function money(v) {
    try { if (typeof formatMoney === 'function') return formatMoney(v); } catch (_) { /* noop */ }
    return 'रू ' + Math.round(v).toLocaleString();
  }

  function moneyField(v) {
    try { if (typeof parseMoneyField === 'function') return num(parseMoneyField(v)); } catch (_) { /* noop */ }
    return num(v);
  }

  // ── 1) Weight-unit toggle buttons for the custom weight entry ──
  function unitSelect() {
    return form.querySelector('select[name="customWeightUnit"]');
  }

  function ensureUnitButtons() {
    if (document.getElementById('order-weight-unit-btns')) return;
    const sel = unitSelect();
    if (!sel) return;
    const wrap = sel.closest('label');
    if (!wrap) return;
    wrap.style.display = 'none';
    const bar = document.createElement('div');
    bar.id = 'order-weight-unit-btns';
    bar.className = 'span-2';
    bar.style.cssText = 'display:flex;align-items:center;gap:.5rem;padding:.15rem 0 .3rem';
    const mk = (value, text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.unit = value;
      b.textContent = text;
      b.style.cssText = 'flex:1;padding:.5rem .8rem;border-radius:8px;border:2px solid #b8860b;background:#fff;color:#b8860b;font-weight:700;font-size:.85rem;cursor:pointer';
      b.addEventListener('click', () => {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        syncUnitButtons();
      });
      return b;
    };
    const lbl = document.createElement('span');
    lbl.textContent = 'Weight unit:';
    lbl.style.cssText = 'font-size:.8rem;font-weight:600;opacity:.75;white-space:nowrap';
    bar.append(lbl, mk('grams', 'Grams (ग्राम)'), mk('tola', 'Tola / Laal'));
    wrap.parentNode.insertBefore(bar, wrap);
    syncUnitButtons();
  }

  function syncUnitButtons() {
    const sel = unitSelect();
    const bar = document.getElementById('order-weight-unit-btns');
    if (!sel || !bar) return;
    bar.querySelectorAll('button[data-unit]').forEach((b) => {
      const active = b.dataset.unit === (sel.value === 'tola' ? 'tola' : 'grams');
      b.style.background = active ? '#b8860b' : '#fff';
      b.style.color = active ? '#fff' : '#b8860b';
    });
  }

  // ── 2) Jarti in percent / grams / laal ──
  function jartiTypeSelect() {
    return document.getElementById('order-jarti-type');
  }

  function ensureJartiLaalOption() {
    const sel = jartiTypeSelect();
    if (!sel || sel.querySelector('option[value="laal"]')) return;
    const gramsOpt = sel.querySelector('option[value="grams"]');
    if (gramsOpt) gramsOpt.textContent = 'Fixed weight (grams)';
    const opt = document.createElement('option');
    opt.value = 'laal';
    opt.textContent = 'Fixed weight (laal)';
    sel.appendChild(opt);
  }

  function syncJartiWraps() {
    const sel = jartiTypeSelect();
    if (!sel) return;
    const type = sel.value;
    const show = (selector, on) => {
      const el = form.querySelector(selector);
      if (el) el.hidden = !on;
    };
    show('#order-jarti-percent-wrap', type === 'percent');
    show('.order-jarti-grams-wrap', type === 'grams');
    show('.order-jarti-laal-wrap', type === 'laal');
    show('.order-jarti-tola-wrap', false);
    show('.order-jarti-aana-wrap', false);
  }

  function jartiGramsForPreview() {
    const sel = jartiTypeSelect();
    if (!sel) return { percent: 0, grams: 0 };
    if (sel.value === 'percent') return { percent: num(form.customJartiRateValue?.value), grams: 0 };
    if (sel.value === 'laal') return { percent: 0, grams: num(form.customJartiLaal?.value) * LAAL_G };
    return { percent: 0, grams: num(form.customJartiGrams?.value) };
  }

  // Keep the grams field in sync so the server computes the same jarti.
  function syncJartiHiddenFields() {
    const sel = jartiTypeSelect();
    if (!sel) return;
    if (sel.value === 'laal') {
      const laal = num(form.customJartiLaal?.value);
      if (form.customJartiGrams) form.customJartiGrams.value = laal > 0 ? Number((laal * LAAL_G).toFixed(4)) : '';
      if (form.customJartiTola) form.customJartiTola.value = '';
      if (form.customJartiAana) form.customJartiAana.value = '';
    } else if (sel.value === 'grams') {
      if (form.customJartiLaal) form.customJartiLaal.value = '';
      if (form.customJartiTola) form.customJartiTola.value = '';
      if (form.customJartiAana) form.customJartiAana.value = '';
    }
  }

  // The server understands percent/grams — laal is already converted above.
  form.addEventListener('submit', () => {
    const sel = jartiTypeSelect();
    if (sel && sel.value === 'laal') {
      syncJartiHiddenFields();
      sel.value = 'grams';
      setTimeout(() => { sel.value = 'laal'; }, 400);
    }
  }, true);

  // ── 3) Clean payment section: two tick-boxes reveal their inputs ──
  const label = (name) => form.elements[name]?.closest ? form.elements[name].closest('label') : null;

  function ensurePaymentToggles() {
    if (document.getElementById('order-pay-toggles')) return;
    const advanceLabel = label('advanceAmount');
    if (!advanceLabel) return;

    // Hide the original cluttered fields.
    const advancePaidLabel = form.advancePaid?.closest('.check-label') || form.advancePaid?.closest('label');
    [advanceLabel, advancePaidLabel, label('customerGoldGrams'), label('goldAddedGrams'), label('remainingPayment')]
      .forEach((el) => { if (el) el.hidden = true; });
    const oldHint = document.getElementById('order-payment-hint');
    if (oldHint) oldHint.hidden = true;

    // Hidden gold-source value sent to the server.
    const src = document.createElement('input');
    src.type = 'hidden';
    src.name = 'goldSource';
    src.id = 'order-gold-source';
    src.value = 'store';
    form.appendChild(src);

    // The two simple options.
    const box = document.createElement('div');
    box.id = 'order-pay-toggles';
    box.className = 'span-2';
    box.style.cssText = 'display:flex;flex-direction:column;gap:.45rem;border:1px solid rgba(184,134,11,.3);background:rgba(184,134,11,.05);border-radius:10px;padding:.65rem .8rem';
    box.innerHTML = `
      <div style="font-size:.78rem;font-weight:700;color:#b8860b">Payment / भुक्तानी (optional)</div>
      <label class="radio-label" style="cursor:pointer">
        <input type="checkbox" id="order-toggle-advance" style="appearance:auto;-webkit-appearance:checkbox;width:17px;height:17px;padding:0;margin:0;accent-color:#b8860b" />
        Advance received (अग्रिम लिएको)
      </label>
      <label class="radio-label" style="cursor:pointer">
        <input type="checkbox" id="order-toggle-gold" style="appearance:auto;-webkit-appearance:checkbox;width:17px;height:17px;padding:0;margin:0;accent-color:#b8860b" />
        Customer gave gold (ग्राहकले सुन दिएको)
      </label>
      <p class="form-hint" id="order-gold-hint" hidden style="margin:.2rem 0 0"></p>`;
    const topAnchor = form.querySelector('#order-inventory-fields')
      || form.querySelector('#order-custom-fields');
    if (topAnchor) topAnchor.parentNode.insertBefore(box, topAnchor);
    else advanceLabel.parentNode.insertBefore(box, advanceLabel);

    document.getElementById('order-toggle-advance').addEventListener('change', (e) => {
      const on = e.target.checked;
      advanceLabel.hidden = !on;
      if (form.advancePaid) form.advancePaid.checked = on;
      if (!on && form.advanceAmount) form.advanceAmount.value = '';
      syncRemainingVisibility();
      refresh();
      if (on) form.advanceAmount?.focus();
    });
    document.getElementById('order-toggle-gold').addEventListener('change', (e) => {
      const on = e.target.checked;
      const cg = label('customerGoldGrams');
      const ga = label('goldAddedGrams');
      if (cg) cg.hidden = !on;
      if (ga) ga.hidden = !on;
      src.value = on ? 'partial' : 'store';
      if (!on) {
        if (form.customerGoldGrams) form.customerGoldGrams.value = '';
        if (form.goldAddedGrams) { form.goldAddedGrams.value = ''; form.goldAddedGrams.readOnly = false; }
        const hint = document.getElementById('order-gold-hint');
        if (hint) hint.hidden = true;
      }
      syncRemainingVisibility();
      refresh();
      if (on) form.customerGoldGrams?.focus();
    });
  }

  function syncRemainingVisibility() {
    const remaining = label('remainingPayment');
    if (!remaining) return;
    const anyOn = document.getElementById('order-toggle-advance')?.checked
      || document.getElementById('order-toggle-gold')?.checked;
    remaining.hidden = !anyOn;
  }

  // ── live payable computation ──
  function jartiWeightGramsTotal() {
    const qty = Math.max(1, num(form.quantity?.value) || 1);
    const j = jartiGramsForPreview();
    if (j.grams > 0) return j.grams * qty;
    if (j.percent > 0) {
      // percent jarti = percent of the item weight
      const mode = form.orderItemMode?.value || 'custom';
      let w = 0;
      if (mode === 'custom') {
        try { w = typeof getWeightGramsFromForm === 'function' ? num(getWeightGramsFromForm(form, 'custom')) : num(form.customWeightGrams?.value); } catch (_) { w = num(form.customWeightGrams?.value); }
      }
      return ((w * j.percent) / 100) * qty;
    }
    return 0;
  }

  function orderWeightGrams() {
    const mode = form.orderItemMode?.value || 'custom';
    const qty = Math.max(1, num(form.quantity?.value) || 1);
    if (mode === 'custom') {
      try {
        if (typeof getWeightGramsFromForm === 'function') {
          return num(getWeightGramsFromForm(form, 'custom')) * qty;
        }
      } catch (_) { /* noop */ }
      return num(form.customWeightGrams?.value) * qty;
    }
    const item = (typeof itemsCache !== 'undefined' ? itemsCache : []).find((i) => i.id === form.itemId?.value);
    return item ? num(item.weightGrams) * qty : 0;
  }

  function orderRateAndKarat() {
    const mode = form.orderItemMode?.value || 'custom';
    let category = 'gold';
    let karat = 24;
    let customRate = 0;
    if (mode === 'custom') {
      category = String(form.customCategory?.value || 'gold').toLowerCase();
      karat = num(form.customKarat?.value) || 24;
      customRate = num(form.customRatePerTola?.value);
    } else {
      const item = (typeof itemsCache !== 'undefined' ? itemsCache : []).find((i) => i.id === form.itemId?.value);
      if (item) {
        category = String(item.category || 'gold').toLowerCase();
        karat = num(item.karat) || 24;
        customRate = num(item.customRatePerTola);
      }
    }
    let rate = 0;
    let kf = 1;
    if (category === 'silver') rate = typeof silverRateCache !== 'undefined' ? num(silverRateCache) : 0;
    else if (category === 'other') rate = customRate;
    else {
      rate = typeof goldRateCache !== 'undefined' ? num(goldRateCache) : 0;
      kf = karat / 24;
    }
    return { rate, kf };
  }

  function baseOrderValue() {
    const mode = form.orderItemMode?.value || 'custom';
    const qty = Math.max(1, num(form.quantity?.value) || 1);
    if (mode !== 'custom') {
      const item = (typeof itemsCache !== 'undefined' ? itemsCache : []).find((i) => i.id === form.itemId?.value);
      if (item && typeof itemValue === 'function') {
        try {
          return itemValue(item, { goldRatePerTola: goldRateCache, silverRatePerTola: silverRateCache }) * qty;
        } catch (_) { /* noop */ }
      }
      return 0;
    }
    const { rate, kf } = orderRateAndKarat();
    const weight = orderWeightGrams();
    const metal = (weight / TOLA) * rate * kf;
    const j = jartiGramsForPreview();
    let jarti = 0;
    if (j.percent > 0) jarti = ((weight * j.percent) / 100 / TOLA) * rate * kf;
    else if (j.grams > 0) jarti = ((j.grams * qty) / TOLA) * rate * kf;
    const making = moneyField(form.customMakingCharge?.value);
    return Math.round(metal + jarti + making * qty);
  }

  function refresh() {
    ensureUnitButtons();
    ensureJartiLaalOption();
    syncJartiWraps();
    syncJartiHiddenFields();
    ensurePaymentToggles();
    syncUnitButtons();

    const goldOn = document.getElementById('order-toggle-gold')?.checked;
    const advanceOn = document.getElementById('order-toggle-advance')?.checked;
    const hint = document.getElementById('order-gold-hint');
    if (!goldOn && !advanceOn) return;

    const weight = orderWeightGrams();
    const base = baseOrderValue();
    let payable = base;

    if (goldOn && weight > 0) {
      const jartiG = jartiWeightGramsTotal();
      const totalNeeded = weight + jartiG; // item weight + jarti (wastage)
      const customerGold = num(form.customerGoldGrams?.value);
      const creditGrams = Math.min(customerGold, totalNeeded);
      const storeAdds = Math.max(0, totalNeeded - creditGrams);
      if (form.goldAddedGrams) {
        form.goldAddedGrams.value = Number(storeAdds.toFixed(4));
        form.goldAddedGrams.readOnly = true;
      }
      const { rate, kf } = orderRateAndKarat();
      const addedValue = Math.round((storeAdds / TOLA) * rate * kf);
      const making = moneyField(form.customMakingCharge?.value) * Math.max(1, num(form.quantity?.value) || 1);
      payable = Math.round(addedValue + making);
      const totalPreview = document.getElementById('order-total-preview');
      if (totalPreview) totalPreview.value = money(payable);
      const advance = num(form.advanceAmount?.value);
      const remaining = Math.max(0, payable - advance);
      if (hint) {
        hint.innerHTML =
          `<strong>Total gold needed:</strong> ${totalNeeded.toFixed(3)}g`
          + (jartiG > 0 ? ` (item ${weight.toFixed(3)}g + jarti ${jartiG.toFixed(3)}g)` : '')
          + ` · customer gave ${creditGrams.toFixed(3)}g · <strong>store adds ${storeAdds.toFixed(3)}g</strong><br>`
          + `Charge for added gold ${money(addedValue)}`
          + (making > 0 ? ` + making ${money(making)}` : '')
          + ` = <strong>${money(payable)}</strong>`
          + (advance > 0 ? ` − advance ${money(advance)} = <strong style="color:#b91c1c">remaining ${money(remaining)}</strong>` : '');
        hint.hidden = false;
      }
    }

    if ((goldOn || advanceOn) && form.remainingPayment && weight > 0) {
      const advance = num(form.advanceAmount?.value);
      form.remainingPayment.value = Math.max(0, payable - advance);
    }
  }

  ['input', 'change'].forEach((evt) => form.addEventListener(evt, refresh));
  setInterval(() => { ensureUnitButtons(); ensureJartiLaalOption(); ensurePaymentToggles(); syncUnitButtons(); }, 1500);
  refresh();
})();
