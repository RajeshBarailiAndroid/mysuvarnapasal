// UX improvements layer — mobile top bar + slide-in menu.
// Additive only: injects a compact header on small screens and turns the
// sidebar into a drawer. No app logic is touched.
(function () {
  'use strict';

  function init() {
    var app = document.querySelector('.app');
    var sidebar = document.querySelector('.sidebar');
    if (!app || !sidebar || document.getElementById('ux-topbar')) return;

    // Top bar
    var bar = document.createElement('header');
    bar.id = 'ux-topbar';
    bar.className = 'ux-topbar';
    bar.innerHTML =
      '<button type="button" class="ux-menu-btn" id="ux-menu-btn" aria-label="Menu" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>' +
      '</button>' +
      '<span class="ux-topbar-brand"><img src="logo.svg" alt="" /><span class="ux-topbar-title" id="ux-topbar-title"></span></span>';
    app.parentNode.insertBefore(bar, app);

    // Backdrop
    var backdrop = document.createElement('div');
    backdrop.className = 'ux-backdrop';
    backdrop.id = 'ux-backdrop';
    document.body.appendChild(backdrop);

    var menuBtn = document.getElementById('ux-menu-btn');

    function setOpen(open) {
      document.body.classList.toggle('ux-nav-open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    menuBtn.addEventListener('click', function () {
      setOpen(!document.body.classList.contains('ux-nav-open'));
    });
    backdrop.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
    // Choosing a section closes the menu
    sidebar.addEventListener('click', function (e) {
      if (e.target.closest('.nav-btn, .settings-nav-btn')) setOpen(false);
    });

    // Title = current section (falls back to the shop name)
    function updateTitle() {
      var active = document.querySelector('.nav-btn.is-active span:not(.nav-icon), .settings-nav-btn.is-active span:not(.nav-icon)');
      var brand = document.getElementById('brand-shop-name');
      var el = document.getElementById('ux-topbar-title');
      if (el) el.textContent = (active && active.textContent.trim()) || (brand && brand.textContent.trim()) || 'Suvarnapasal';
    }
    updateTitle();
    new MutationObserver(updateTitle).observe(sidebar, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
