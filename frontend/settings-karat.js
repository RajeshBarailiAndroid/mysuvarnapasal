// settings-karat.js — shows the gold rate per karat (24K / 22K / 18K)
// under the gold-rate fields in Settings, updating live while typing.

/* eslint-disable no-undef */

(function initKaratRates() {
  const form = document.getElementById('settings-form');
  const panel = document.getElementById('karat-rate-panel');
  if (!form || !panel) return;

  const TOLA = 11.664;
  const KARATS = [24, 22, 18];

  function money(v) {
    try {
      if (typeof formatMoney === 'function') return formatMoney(v);
    } catch (_) { /* fall through */ }
    return 'रू ' + Math.round(v).toLocaleString();
  }

  function refresh() {
    const perTola = Number(form.goldRatePerTola?.value)
      || (Number(form.goldRatePerGram?.value) || 0) * TOLA
      || (typeof goldRateCache !== 'undefined' ? Number(goldRateCache) : 0)
      || 0;
    if (!(perTola > 0)) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    panel.innerHTML = KARATS.map((k) => {
      const tola = perTola * (k / 24);
      const gram = tola / TOLA;
      return `<div style="flex:1;min-width:150px;border:1px solid rgba(184,134,11,.35);background:rgba(184,134,11,.07);border-radius:8px;padding:.5rem .7rem">
        <div style="font-size:.75rem;font-weight:700;color:#b8860b">${k}K ${k === 24 ? '(चोखो)' : k === 22 ? '(तेजाबी)' : ''}</div>
        <div style="font-weight:700;font-size:.95rem">${money(Math.round(tola))} <span style="font-size:.7rem;font-weight:500;opacity:.6">/tola</span></div>
        <div style="font-size:.72rem;opacity:.65">${money(Math.round(gram))} /gram · ${money(Math.round(gram * 10))} /10g</div>
      </div>`;
    }).join('');
    panel.hidden = false;
  }

  ['input', 'change'].forEach((evt) => form.addEventListener(evt, refresh));
  // refresh when settings load into the form
  setInterval(refresh, 2000);
  refresh();
})();
