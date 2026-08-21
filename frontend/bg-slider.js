(function initBackgroundSliders() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SLIDE_MS = reduceMotion ? 0 : 7000;
  const FADE_MS = reduceMotion ? 0 : 1400;
  document.documentElement.style.setProperty('--bg-slide-fade-ms', `${FADE_MS}ms`);

  function startCycle(slider) {
    const slides = [...slider.querySelectorAll('.bg-slide')];
    if (slides.length < 2 || reduceMotion) return;
    let current = 0;
    setInterval(() => {
      slides[current].classList.remove('is-active');
      current = (current + 1) % slides.length;
      slides[current].classList.add('is-active');
    }, SLIDE_MS);
  }

  function buildSlider(images) {
    const slider = document.createElement('div');
    slider.className = 'bg-slider';
    slider.setAttribute('aria-hidden', 'true');
    images.forEach((item, index) => {
      const slide = document.createElement('div');
      slide.className = 'bg-slide' + (index === 0 ? ' is-active' : '');
      slide.style.backgroundImage = `url("${item.src}")`;
      slider.appendChild(slide);
    });
    return slider;
  }

  function mountContained(host, images, overlayClass) {
    const slider = buildSlider(images);
    const overlay = document.createElement('div');
    overlay.className = `bg-overlay ${overlayClass}`;
    host.insertBefore(slider, host.firstChild);
    host.insertBefore(overlay, slider.nextSibling);
    startCycle(slider);
  }

  function mountFixed(images, overlayClass) {
    const slider = buildSlider(images);
    slider.classList.add('bg-slider--fixed');
    const overlay = document.createElement('div');
    overlay.className = `bg-overlay bg-overlay--fixed ${overlayClass}`;
    document.body.insertBefore(overlay, document.body.firstChild);
    document.body.insertBefore(slider, document.body.firstChild);
    startCycle(slider);
  }

  function initMounts(images) {
    const brand = document.querySelector('.auth-page-brand');

    if (brand) mountContained(brand, images, 'bg-overlay--auth-brand');
    else if (document.body.classList.contains('auth-page')) mountFixed(images, 'bg-overlay--auth-page');
  }

  fetch('/bg-images.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const images = (data?.images || []).filter((item) => item?.src);
      if (images.length) initMounts(images);
    })
    .catch(() => { /* keep gradient fallback */ });
})();
