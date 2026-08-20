// item-qr.js — per-item QR codes for jewellery tags.
// A "QR" button on each inventory row opens a modal with the item's QR code.
// Scanning it with any phone camera shows the item details as text.
// Uses the bundled qrcode.js (works fully offline).
//
// Tag printing supports label printers (Dymo, Phomemo, ...): the page size is
// set to the exact label size so there is no scaling and no margins. Printing
// happens through a hidden same-page <iframe>, NOT window.open() — the desktop
// (Electron) app denies popup windows for security, and iframes also dodge
// browser popup blockers on the web version.

/* eslint-disable no-undef */

(function initItemQr() {
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function qrTextForItem(item) {
    const shop = (typeof settingsCache === 'object' && settingsCache && settingsCache.shopName) || 'SubarnaPasal';
    const tola = item.weightGrams ? (item.weightGrams / 11.664).toFixed(3) : '0';
    const lines = [
      shop,
      `${item.name} (${item.sku})`,
      `Karat: ${item.karat}K · Weight: ${item.weightGrams}g (${tola} tola)`,
    ];
    if (Number(item.makingCharge) > 0) lines.push(`Making: ${item.makingCharge}`);
    if (item.jartiRateValue > 0) lines.push(`Jarti: ${item.jartiRateValue}${item.jartiRateType === 'percent' ? '%' : ` (${item.jartiRateType})`}`);
    if (item.hallmarkNumber) lines.push(`Hallmark: ${item.hallmarkNumber}`);
    if (item.hsCode) lines.push(`HS: ${item.hsCode}`);
    if (item.location) lines.push(`Location: ${item.location}`);
    return lines.join('\n');
  }

  function buildQrSvg(text, cellSize) {
    if (typeof qrcode !== 'function') return null;
    try {
      if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
        qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
      }
      const qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      return qr.createSvgTag({ cellSize: cellSize || 5, margin: 4, scalable: true });
    } catch (err) {
      console.warn('QR generation failed:', err);
      return null;
    }
  }

  // ── Label sizes ─────────────────────────────────────────────────────────
  // The printed QR carries only the SKU: a full-detail QR is too dense to
  // scan at these sizes, but a short SKU code scans instantly with any phone.
  const LABEL_SIZES = {
    'dymo-11x44': { w: 44, h: 11, label: 'Dymo 44×11 (jewelry barbell)' },
    'phomemo-40x30': { w: 40, h: 30, label: 'Phomemo 40×30' }
  };
  const LABEL_SIZE_KEY = 'subarnapasal.tagLabelSize';

  function currentLabelSize() {
    try {
      const v = localStorage.getItem(LABEL_SIZE_KEY);
      if (v && LABEL_SIZES[v]) return v;
    } catch (_) { /* ignore */ }
    return 'phomemo-40x30';
  }

  function rememberLabelSize(key) {
    try { if (LABEL_SIZES[key]) localStorage.setItem(LABEL_SIZE_KEY, key); } catch (_) { /* ignore */ }
  }

  function labelBodyHtml(item, sizeKey, svg) {
    const tola = item.weightGrams ? (item.weightGrams / 11.664).toFixed(2) : '0';
    const meta1 = `${esc(String(item.karat))}K · ${esc(String(item.weightGrams))}g · ${esc(tola)} tola`;
    const meta2 = `<strong>${esc(item.sku)}</strong>${item.hallmarkNumber ? ' · HM ' + esc(item.hallmarkNumber) : ''}`;

    if (sizeKey === 'dymo-11x44') {
      // Narrow horizontal strip: QR left, three tiny text lines right.
      return `
      <style>
        .wrap { display: flex; align-items: center; width: 44mm; height: 11mm; }
        .qr { flex: 0 0 auto; width: 9.5mm; height: 9.5mm; margin-left: 0.7mm; }
        .qr svg { width: 100%; height: 100%; }
        .txt { flex: 1; min-width: 0; padding-left: 1mm; padding-right: 0.7mm; line-height: 1.18; }
        .name { font-size: 5.5pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .meta { font-size: 5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="wrap">
        <div class="qr">${svg}</div>
        <div class="txt">
          <div class="name">${esc(item.name)}</div>
          <div class="meta">${meta1}</div>
          <div class="meta">${meta2}</div>
        </div>
      </div>`;
    }

    // 40×30: roomier — shop name on top, QR left, details right.
    const shop = (typeof settingsCache === 'object' && settingsCache && settingsCache.shopName) || '';
    return `
      <style>
        .wrap { width: 40mm; height: 30mm; padding: 1mm 1.2mm; box-sizing: border-box; display: flex; flex-direction: column; }
        .shop { font-size: 6pt; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 0.2mm solid #000; padding-bottom: 0.5mm; margin-bottom: 0.8mm; }
        .row { display: flex; flex: 1; align-items: center; min-height: 0; }
        .qr { flex: 0 0 auto; width: 17mm; height: 17mm; }
        .qr svg { width: 100%; height: 100%; }
        .txt { flex: 1; min-width: 0; padding-left: 1.2mm; line-height: 1.25; }
        .name { font-size: 7pt; font-weight: 700; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .meta { font-size: 6pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="wrap">
        ${shop ? `<div class="shop">${esc(shop)}</div>` : ''}
        <div class="row">
          <div class="qr">${svg}</div>
          <div class="txt">
            <div class="name">${esc(item.name)}</div>
            <div class="meta">${meta1}</div>
            <div class="meta">${meta2}</div>
          </div>
        </div>
      </div>`;
  }

  function printQrTag(sizeKey) {
    if (!currentItem) return;
    const item = currentItem;
    const size = LABEL_SIZES[sizeKey] ? sizeKey : currentLabelSize();
    const dims = LABEL_SIZES[size];
    rememberLabelSize(size);
    const svg = buildQrSvg(String(item.sku || item.id || ''), 2);
    if (!svg) return;
    const html = `<!DOCTYPE html><html><head><title>${esc(item.sku)}</title>
      <style>
        @page { size: ${dims.w}mm ${dims.h}mm; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${dims.w}mm; height: ${dims.h}mm; overflow: hidden; }
        body { font-family: sans-serif; -webkit-print-color-adjust: exact; }
      </style></head><body>${labelBodyHtml(item, size, svg)}</body></html>`;

    // Reuse one frame so repeated prints don't pile up invisible iframes.
    let frame = document.getElementById('item-qr-print-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'item-qr-print-frame';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    // Give the frame a moment to lay out, then print just the label.
    setTimeout(() => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (err) {
        console.warn('Tag print failed:', err);
      }
    }, 150);
  }

  function labelSelectHtml(id) {
    const cur = currentLabelSize();
    return `<select id="${id}" style="padding:.35rem .5rem;border-radius:6px;border:1px solid #d1d5db;font-size:.8rem">
      ${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v.label}</option>`).join('')}
    </select>`;
  }

  function ensureModal() {
    let modal = document.getElementById('item-qr-modal');
    if (modal) return modal;
    modal = document.createElement('dialog');
    modal.id = 'item-qr-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div style="min-width:320px">
        <header class="modal-head">
          <h2 id="item-qr-title">Item QR</h2>
          <button type="button" class="icon-btn" id="item-qr-close" aria-label="Close">×</button>
        </header>
        <div id="item-qr-body" style="display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:.4rem 0 .8rem">
        </div>
        <footer class="modal-foot" style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          ${labelSelectHtml('item-qr-label-size')}
          <span style="flex:1"></span>
          <button type="button" class="btn btn-outline" id="item-qr-close2">Close</button>
          <button type="button" class="btn btn-gold" id="item-qr-print">Print tag</button>
        </footer>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#item-qr-close').addEventListener('click', () => modal.close());
    modal.querySelector('#item-qr-close2').addEventListener('click', () => modal.close());
    modal.querySelector('#item-qr-label-size').addEventListener('change', (e) => rememberLabelSize(e.target.value));
    modal.querySelector('#item-qr-print').addEventListener('click', () => {
      const sel = modal.querySelector('#item-qr-label-size');
      printQrTag(sel ? sel.value : undefined);
    });
    return modal;
  }

  let currentItem = null;

  window.printItemTag = function printItemTag(itemId) {
    const list = typeof itemsCache !== 'undefined' ? itemsCache : [];
    const item = list.find((i) => i.id === itemId);
    if (!item) return;
    currentItem = item;
    printQrTag(); // uses the last label size chosen in the QR popup
  };

  window.showItemQr = function showItemQr(itemId) {
    const list = typeof itemsCache !== 'undefined' ? itemsCache : [];
    const item = list.find((i) => i.id === itemId);
    if (!item) return;
    currentItem = item;
    const modal = ensureModal();
    const svg = buildQrSvg(qrTextForItem(item), 5);
    const body = modal.querySelector('#item-qr-body');
    modal.querySelector('#item-qr-title').textContent = `QR — ${item.name}`;
    body.innerHTML = svg
      ? `<div id="item-qr-svg" style="width:220px;height:220px;background:#fff;padding:6px;border:1px solid #e5e7eb;border-radius:8px">${svg}</div>
         <div style="text-align:center;font-size:.85rem">
           <strong>${esc(item.name)}</strong> · ${esc(item.sku)}<br>
           <span style="opacity:.7">${esc(String(item.karat))}K · ${esc(String(item.weightGrams))}g</span>
         </div>
         <div style="font-size:.72rem;opacity:.55;text-align:center">Scan with any phone camera to see the item details.</div>`
      : '<p class="panel-desc">QR library not loaded.</p>';
    modal.showModal();
  };

  // QR buttons on inventory rows (delegated — table re-renders often).
  document.getElementById('inventory-table')?.addEventListener('click', (e) => {
    const printBtn = e.target.closest('[data-print-tag]');
    if (printBtn) {
      e.preventDefault();
      e.stopPropagation();
      window.printItemTag(printBtn.dataset.printTag);
      return;
    }
    const btn = e.target.closest('[data-qr]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    window.showItemQr(btn.dataset.qr);
  });
})();
