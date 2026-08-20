// SubarnaPasal Nepali keyboard (transliteration IME).
//
// A small EN | ने toggle floats at the bottom-right whenever you're typing in
// a text field. In ने mode, Roman letters become Devanagari as you type:
//   suna → सुन    nepal → नेपाल    jarti → जर्ति    raam → राम
// Capital letters give retroflex sounds: T=ट Th=ठ D=ड Dh=ढ N=ण Sh=ष.
// The choice is remembered (per computer) and applies to every text box.
(function () {
  'use strict';

  const STORE_KEY = 'subarnapasal.kbd';
  let mode = 'en';
  try { mode = localStorage.getItem(STORE_KEY) === 'ne' ? 'ne' : 'en'; } catch (_) {}

  // ── Transliteration tables ──────────────────────────────────────────────
  // [independent form, matra] for vowels; single Devanagari for consonants.
  const VOWELS = {
    a: ['अ', ''], aa: ['आ', 'ा'], A: ['आ', 'ा'],
    i: ['इ', 'ि'], ii: ['ई', 'ी'], I: ['ई', 'ी'], ee: ['ई', 'ी'],
    u: ['उ', 'ु'], uu: ['ऊ', 'ू'], U: ['ऊ', 'ू'], oo: ['ऊ', 'ू'],
    e: ['ए', 'े'], ai: ['ऐ', 'ै'], o: ['ओ', 'ो'], au: ['औ', 'ौ'],
    Ri: ['ऋ', 'ृ'],
  };
  const CONS = {
    kh: 'ख', k: 'क', gh: 'घ', g: 'ग', ng: 'ङ',
    chh: 'छ', Chh: 'छ', ch: 'च', c: 'च',
    jh: 'झ', j: 'ज', z: 'ज', ny: 'ञ',
    Th: 'ठ', T: 'ट', Dh: 'ढ', D: 'ड', N: 'ण',
    th: 'थ', t: 'त', dh: 'ध', d: 'द', n: 'न',
    ph: 'फ', p: 'प', f: 'फ', bh: 'भ', b: 'ब', m: 'म',
    y: 'य', r: 'र', l: 'ल', v: 'व', w: 'व',
    Sh: 'ष', sh: 'श', s: 'स', h: 'ह',
    ksh: 'क्ष', x: 'क्ष', gy: 'ज्ञ', q: 'क',
    M: 'ं',  // anusvara: raM → रं
  };
  const HALANT = '्';
  // Longest tokens first so 'chh' wins over 'ch' over 'c'.
  const TOKENS = Object.keys(VOWELS).concat(Object.keys(CONS))
    .sort(function (a, b) { return b.length - a.length; });

  function transliterate(word) {
    let out = '';
    let i = 0;
    let lastWasCons = false;
    while (i < word.length) {
      let matched = null;
      for (const tok of TOKENS) {
        if (word.startsWith(tok, i)) { matched = tok; break; }
      }
      if (!matched) { out += word[i]; i += 1; lastWasCons = false; continue; }
      if (VOWELS[matched]) {
        out += lastWasCons ? VOWELS[matched][1] : VOWELS[matched][0];
        lastWasCons = false;
      } else {
        const dev = CONS[matched];
        if (dev === 'ं') { out += dev; lastWasCons = false; }
        else {
          if (lastWasCons) out += HALANT;
          out += dev;
          lastWasCons = true;
        }
      }
      i += matched.length;
    }
    return out;
  }

  // ── Which fields participate ────────────────────────────────────────────
  function eligible(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.dataset.noTranslit;
    if (el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search'].includes(type) && !el.dataset.noTranslit;
  }

  // ── Typing engine: buffer the current Roman word, live-replace it ───────
  let buffer = '';
  let start = null; // caret index where the current word began
  let activeEl = null;

  function resetBuffer() { buffer = ''; start = null; }

  // The whole feature is active only while the APP language is Nepali
  // (Settings → language). setLang() writes document.documentElement.lang.
  function appLangIsNepali() {
    if (document.documentElement.lang === 'ne') return true;
    try { return localStorage.getItem('subarnapasal.lang') === 'ne'; } catch (_) { return false; }
  }

  function onKeydown(e) {
    if (!appLangIsNepali()) return;
    if (mode !== 'ne') return;
    const el = e.target;
    if (!eligible(el)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) { resetBuffer(); return; }

    if (activeEl !== el) { resetBuffer(); activeEl = el; }

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      if (start === null || el.selectionStart == null) start = el.selectionStart ?? el.value.length;
      buffer += e.key;
      const dev = transliterate(buffer);
      const from = start;
      const to = el.selectionStart ?? el.value.length;
      el.setRangeText(dev, from, to, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.key === 'Backspace' && buffer.length > 0) {
      e.preventDefault();
      buffer = buffer.slice(0, -1);
      const dev = transliterate(buffer);
      const from = start;
      const to = el.selectionStart ?? el.value.length;
      el.setRangeText(dev, from, to, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (buffer.length === 0) resetBuffer();
      return;
    }
    // Space, punctuation, arrows, Enter… — commit the word and let it through.
    resetBuffer();
  }

  // ── The floating EN | ने | ⌨ toggle ─────────────────────────────────────
  let pill = null;

  function buildPill() {
    pill = document.createElement('div');
    pill.id = 'np-kbd-toggle';
    pill.setAttribute('title', 'नेपाली किबोर्ड — on-screen Nepali keyboard');
    pill.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99999;display:inline-block;'
      + 'background:#fff;border:1px solid #d5cbb4;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.15);'
      + 'font:600 16px/1 -apple-system,sans-serif;cursor:pointer;user-select:none;overflow:hidden';
    pill.innerHTML = '<span data-kbd="board" style="display:inline-block;padding:9px 13px">⌨</span>';
    pill.addEventListener('mousedown', function (e) {
      e.preventDefault(); // keep focus in the text field
      toggleBoard();
    });
    document.body.appendChild(pill);
  }

  // ── Floating on-screen Nepali keyboard (click to type) ──────────────────
  let board = null;
  let boardOpen = false;

  const BOARD_ROWS = [
    ['१', '२', '३', '४', '५', '६', '७', '८', '९', '०'],
    ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ'],
    ['क', 'ख', 'ग', 'घ', 'ङ', 'च', 'छ', 'ज', 'झ', 'ञ'],
    ['ट', 'ठ', 'ड', 'ढ', 'ण', 'त', 'थ', 'द', 'ध', 'न'],
    ['प', 'फ', 'ब', 'भ', 'म', 'य', 'र', 'ल', 'व', 'श'],
    ['ष', 'स', 'ह', 'क्ष', 'त्र', 'ज्ञ', 'ऋ', 'ँ', 'ं', 'ः'],
    ['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', '्'],
    ['SPACE', '⌫', '।', ',', '✕'],
  ];

  function buildBoard() {
    board = document.createElement('div');
    board.id = 'np-kbd-board';
    board.style.cssText = 'position:fixed;bottom:60px;right:14px;z-index:99998;display:none;'
      + 'background:#fffdf7;border:1px solid #d5cbb4;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.22);'
      + 'padding:10px;user-select:none;max-width:430px';
    let html = '<div style="font:600 11px -apple-system,sans-serif;color:#7a5c00;margin:0 2px 8px;display:flex;justify-content:space-between">'
      + '<span>नेपाली किबोर्ड — क्लिक गरेर टाइप गर्नुहोस्</span></div>';
    for (const row of BOARD_ROWS) {
      html += '<div style="display:flex;gap:4px;margin-bottom:4px;justify-content:center">';
      for (const key of row) {
        const wide = key === 'SPACE';
        const label = key === 'SPACE' ? 'space' : key;
        html += '<button type="button" data-np-key="' + key + '" style="'
          + 'font:600 ' + (wide ? '11px' : '16px') + ' -apple-system,sans-serif;'
          + (wide ? 'flex:3;' : 'min-width:36px;')
          + 'padding:7px 4px;border:1px solid #e2d9c4;border-radius:8px;background:#fff;'
          + 'cursor:pointer;color:#2b2b2b">' + label + '</button>';
      }
      html += '</div>';
    }
    board.innerHTML = html;
    // mousedown (not click) + preventDefault keeps the text field focused.
    board.addEventListener('mousedown', function (e) {
      e.preventDefault();
      const btn = e.target.closest('[data-np-key]');
      if (!btn) return;
      pressBoardKey(btn.dataset.npKey);
    });
    document.body.appendChild(board);
  }

  function pressBoardKey(key) {
    if (key === '✕') { toggleBoard(false); return; }
    const el = (activeEl && eligible(activeEl)) ? activeEl : null;
    if (!el) return;
    resetBuffer(); // on-screen typing bypasses the Roman buffer
    if (key === '⌫') {
      const from = el.selectionStart ?? el.value.length;
      const to = el.selectionEnd ?? from;
      if (to > 0) el.setRangeText('', from === to ? from - 1 : from, to, 'end');
    } else {
      const text = key === 'SPACE' ? ' ' : key;
      const from = el.selectionStart ?? el.value.length;
      const to = el.selectionEnd ?? from;
      el.setRangeText(text, from, to, 'end');
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  function toggleBoard(force) {
    boardOpen = force !== undefined ? !!force : !boardOpen;
    if (board) board.style.display = boardOpen ? 'block' : 'none';
    if (boardOpen && pill) pill.style.display = 'inline-block';
  }

  function paintPill() {
    if (!pill) return;
    pill.querySelectorAll('span').forEach(function (s) {
      const on = s.dataset.kbd === mode;
      s.style.background = on ? '#c9a227' : 'transparent';
      s.style.color = on ? '#fff' : '#7a5c00';
    });
  }

  function setMode(m) {
    mode = m === 'ne' ? 'ne' : 'en';
    try { localStorage.setItem(STORE_KEY, mode); } catch (_) {}
    resetBuffer();
    paintPill();
  }

  function updateVisibility() {
    const on = appLangIsNepali();
    if (pill) pill.style.display = on ? 'inline-block' : 'none';
    if (!on && boardOpen) toggleBoard(false);
  }

  // Modal <dialog>s (Add Record, Pay, settings…) block clicks on anything
  // outside their top layer — so the keyboard must live INSIDE the open
  // dialog while you type there, and move back to the page afterwards.
  function reparentTo(host) {
    if (pill && pill.parentNode !== host) host.appendChild(pill);
    if (board && board.parentNode !== host) host.appendChild(board);
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildPill();
    buildBoard();
    updateVisibility(); // shown only while the app language is Nepali
    // React instantly when the language is switched in Settings.
    try {
      new MutationObserver(updateVisibility)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    } catch (_) {}
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', function (e) {
      if (eligible(e.target)) {
        activeEl = e.target;
        const dlg = e.target.closest ? e.target.closest('dialog') : null;
        reparentTo(dlg || document.body);
      }
      resetBuffer();
    });
    document.addEventListener('focusout', function () { resetBuffer(); });
    // When any dialog closes, bring the keyboard back to the page.
    document.addEventListener('close', function () { reparentTo(document.body); }, true);
  });

  // Exposed for other scripts/tests.
  window.spNepaliInput = { transliterate: transliterate, setMode: setMode, getMode: function () { return mode; } };
})();
