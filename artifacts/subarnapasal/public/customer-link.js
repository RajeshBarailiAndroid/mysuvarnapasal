/**
 * "Customer link" on the Requested page.
 *
 * The shop shares one link — /order/<code> — and customers use it to browse
 * what is in stock and ask for pieces. Whatever they send lands in this same
 * Requested list (source: 'link'), so there is nothing else to check.
 *
 * The code comes from GET /api/public-link, which is scoped to the signed-in
 * shop. This panel just shows it, copies it, opens it, and prints a QR poster
 * for the counter — customers scan instead of typing.
 */
(function () {
  'use strict';

  let cachedLink = null;   // { code, url, pageUrl }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function tt(key, fallback) {
    try {
      if (typeof t === 'function') {
        const v = t(key);
        if (v && v !== key) return v;
      }
    } catch (_) { /* i18n not ready */ }
    return fallback;
  }

  /**
   * The link the customer should open. The server reports it from APP_URL /
   * PUBLIC_APP_URL, which may be a placeholder in local dev — so when the code
   * is all we can trust, rebuild the URL against the origin actually in use.
   */
  function customerUrl(link) {
    if (!link || !link.code) return '';
    return `${window.location.origin}/order/${link.code}`;
  }

  async function fetchLink() {
    if (cachedLink) return cachedLink;
    cachedLink = await api('/api/public-link');
    return cachedLink;
  }

  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    try {
      if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
        qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
      }
      const qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
    } catch (err) {
      console.warn('QR generation failed:', err);
      return '';
    }
  }

  function ensureDialog() {
    let dlg = document.getElementById('customer-link-modal');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'customer-link-modal';
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form method="dialog" style="padding:1.25rem">
        <h2 style="margin:0 0 .35rem;font-size:1.05rem">${esc(tt('customerLinkTitle', 'Customer link'))}</h2>
        <p class="panel-desc" style="margin:0 0 1rem">${esc(tt('customerLinkDesc', 'Share this link with customers. They enter their name and phone, browse what is in stock, and what they select appears here in Requested.'))}</p>
        <div id="customer-link-body"></div>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
          <button type="submit" class="btn btn-outline">${esc(tt('close', 'Close'))}</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    return dlg;
  }

  function renderBody(link) {
    const url = customerUrl(link);
    const svg = qrSvg(url);
    return `
      <label style="display:block;font-size:.78rem;color:var(--muted);margin-bottom:.3rem">
        ${esc(tt('customerLinkUrlLabel', 'Link to share'))}
      </label>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <input id="customer-link-url" type="text" readonly value="${esc(url)}"
          style="flex:1 1 240px;min-width:0" />
        <button type="button" class="btn btn-gold btn-sm" id="customer-link-copy">${esc(tt('copy', 'Copy'))}</button>
        <a class="btn btn-outline btn-sm" id="customer-link-open" href="${esc(url)}" target="_blank" rel="noopener">${esc(tt('customerLinkOpen', 'Open'))}</a>
      </div>
      <p class="panel-desc" style="margin:.75rem 0 0">${esc(tt('customerLinkQrHint', 'Or let customers scan this at the counter:'))}</p>
      <div id="customer-link-qr" style="max-width:200px;margin:.5rem auto 0;background:#fff;padding:.5rem;border-radius:8px">${svg}</div>
      <p class="panel-desc" style="margin:.75rem 0 0;font-size:.75rem">
        ${esc(tt('customerLinkPrivacy', 'The link only shows in-stock items and lets people file a request — it cannot open sales, customers, or settings.'))}
      </p>`;
  }

  async function openDialog() {
    const dlg = ensureDialog();
    const body = dlg.querySelector('#customer-link-body');
    body.innerHTML = `<p class="panel-desc">${esc(tt('loading', 'Loading…'))}</p>`;
    if (!dlg.open) dlg.showModal();
    try {
      const link = await fetchLink();
      body.innerHTML = renderBody(link);
      const copyBtn = body.querySelector('#customer-link-copy');
      const input = body.querySelector('#customer-link-url');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(input.value);
        } catch (_) {
          input.select();
          document.execCommand('copy');
        }
        if (typeof toast === 'function') toast(tt('customerLinkCopied', 'Link copied.'));
      });
    } catch (err) {
      body.innerHTML = `<p class="panel-desc">${esc(err.message || String(err))}</p>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('customer-link-btn');
    if (btn) btn.addEventListener('click', openDialog);
  });
})();
