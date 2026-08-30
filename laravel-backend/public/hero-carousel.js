(function initHomeHeroCarousel() {
  const host = document.getElementById('home-hero');
  if (!host) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SLIDE_MS = reduceMotion ? 0 : 5000;

  function buildHero(images) {
    if (!images.length) return;

    const track = document.createElement('div');
    track.className = 'home-hero-track';

    images.forEach((item, index) => {
      const slide = document.createElement('article');
      slide.className = 'home-hero-slide' + (index === 0 ? ' is-active' : '');
      slide.innerHTML = `
        <img class="home-hero-img" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || '')}" loading="${index === 0 ? 'eager' : 'lazy'}" />
        <div class="home-hero-shade"></div>
        <div class="home-hero-caption">
          <span class="home-hero-tag" data-i18n="heroCollectionTag">Gold Collection</span>
          <h2 class="home-hero-title">${escapeHtml(item.alt || '')}</h2>
        </div>`;
      track.appendChild(slide);
    });

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'home-hero-nav home-hero-prev';
    prev.setAttribute('aria-label', 'Previous slide');
    prev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'home-hero-nav home-hero-next';
    next.setAttribute('aria-label', 'Next slide');
    next.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';

    const dots = document.createElement('div');
    dots.className = 'home-hero-dots';
    dots.setAttribute('role', 'tablist');
    images.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'home-hero-dot' + (index === 0 ? ' is-active' : '');
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Slide ${index + 1}`);
      dot.dataset.index = String(index);
      dots.appendChild(dot);
    });

    host.innerHTML = '';
    host.append(track, prev, next, dots);
    host.hidden = false;

    if (typeof applyStaticI18n === 'function') applyStaticI18n();

    const slides = [...track.querySelectorAll('.home-hero-slide')];
    const dotBtns = [...dots.querySelectorAll('.home-hero-dot')];
    let current = 0;
    let timer = null;

    function goTo(index) {
      slides[current].classList.remove('is-active');
      dotBtns[current].classList.remove('is-active');
      current = (index + slides.length) % slides.length;
      slides[current].classList.add('is-active');
      dotBtns[current].classList.add('is-active');
    }

    function nextSlide() { goTo(current + 1); }
    function prevSlide() { goTo(current - 1); }

    function resetTimer() {
      if (!SLIDE_MS) return;
      clearInterval(timer);
      timer = setInterval(nextSlide, SLIDE_MS);
    }

    prev.addEventListener('click', () => { prevSlide(); resetTimer(); });
    next.addEventListener('click', () => { nextSlide(); resetTimer(); });
    dots.addEventListener('click', (e) => {
      const btn = e.target.closest('.home-hero-dot');
      if (!btn) return;
      goTo(Number(btn.dataset.index));
      resetTimer();
    });

    resetTimer();
  }

  fetch('/bg-images.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const images = (data?.images || []).filter((item) => item?.src);
      if (images.length) buildHero(images);
    })
    .catch(() => {});
})();
