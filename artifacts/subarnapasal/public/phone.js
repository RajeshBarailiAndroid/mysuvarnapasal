(function initPhoneValidation(global) {
  const PHONE_REGION_STORAGE_KEY = 'subarnapasal.phoneRegion';

  const PHONE_REGION_CONFIG = {
    NP: {
      placeholderKey: 'authPhonePlaceholderNP',
      placeholder: '98XXXXXXXX',
      hintKey: 'authEmailOrPhoneHintNP',
      customerHintKey: 'customerPhoneHintNP',
      invalidKey: 'authInvalidPhoneNP'
    },
    US: {
      placeholderKey: 'authPhonePlaceholderUS',
      placeholder: '(202) 555-1234',
      hintKey: 'authEmailOrPhoneHintUS',
      customerHintKey: 'customerPhoneHintUS',
      invalidKey: 'authInvalidPhoneUS'
    },
    CA: {
      placeholderKey: 'authPhonePlaceholderCA',
      placeholder: '(416) 555-1234',
      hintKey: 'authEmailOrPhoneHintCA',
      customerHintKey: 'customerPhoneHintCA',
      invalidKey: 'authInvalidPhoneCA'
    }
  };

  function phoneDigits(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  function isNepaliPhone(digits) {
    const national = String(digits).replace(/^977/, '');
    return /^(97|98)\d{8}$/.test(national);
  }

  function isNanpPhone(digits) {
    const d = String(digits).replace(/^1/, '');
    return d.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(d);
  }

  function isUsPhone(digits) {
    return isNanpPhone(digits);
  }

  function isCanadianPhone(digits) {
    return isNanpPhone(digits);
  }

  function normalizePhoneRegion(region) {
    const code = String(region || 'NP').toUpperCase();
    return PHONE_REGION_CONFIG[code] ? code : 'NP';
  }

  function detectPhoneRegion() {
    try {
      const saved = localStorage.getItem(PHONE_REGION_STORAGE_KEY);
      if (saved && PHONE_REGION_CONFIG[saved]) return saved;
    } catch (_) { /* ignore */ }

    const lang = String(navigator.language || '').toLowerCase();
    if (lang.includes('ne') || lang.endsWith('-np')) return 'NP';
    if (lang.endsWith('-ca')) return 'CA';
    if (lang.endsWith('-us')) return 'US';

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (tz.includes('Kathmandu')) return 'NP';
      if (/^America\/(Toronto|Vancouver|Halifax|Winnipeg|Edmonton|Regina|St_Johns|Moncton|Yellowknife|Whitehorse|Iqaluit|Inuvik)/.test(tz)) {
        return 'CA';
      }
      if (tz.startsWith('America/')) return 'US';
    } catch (_) { /* ignore */ }

    return 'NP';
  }

  function isValidPhoneForRegion(phone, region) {
    const digits = phoneDigits(phone);
    if (!digits) return false;
    const r = normalizePhoneRegion(region);
    if (r === 'NP') return isNepaliPhone(digits);
    if (r === 'US') return isUsPhone(digits);
    if (r === 'CA') return isCanadianPhone(digits);
    return false;
  }

  function isValidPhone(phone, region) {
    if (region) return isValidPhoneForRegion(phone, region);
    const digits = phoneDigits(phone);
    if (!digits) return false;
    return isNepaliPhone(digits) || isNanpPhone(digits);
  }

  function regionLabel(region) {
    const key = `authPhoneRegion${normalizePhoneRegion(region)}`;
    return typeof global.t === 'function' ? global.t(key) : region;
  }

  function applyPhoneRegionUI(regionSelect, phoneInput, hintEl, hintMode) {
    if (!regionSelect) return;
    const region = normalizePhoneRegion(regionSelect.value);
    const cfg = PHONE_REGION_CONFIG[region];
    if (!cfg) return;

    try {
      localStorage.setItem(PHONE_REGION_STORAGE_KEY, region);
    } catch (_) { /* ignore */ }

    if (phoneInput) {
      phoneInput.placeholder = typeof global.t === 'function'
        ? global.t(cfg.placeholderKey)
        : cfg.placeholder;
    }
    if (hintEl && typeof global.t === 'function') {
      const hintKey = hintMode === 'customer' ? cfg.customerHintKey : cfg.hintKey;
      hintEl.textContent = global.t(hintKey);
    }
  }

  function initPhoneRegionUI(options = {}) {
    const regionSelect = document.getElementById(options.regionSelectId);
    const phoneInput = options.phoneInputId
      ? document.getElementById(options.phoneInputId)
      : null;
    const hintEl = options.hintId
      ? document.getElementById(options.hintId)
      : null;
    const hintMode = options.hintMode === 'customer' ? 'customer' : 'auth';
    if (!regionSelect) return null;

    const detected = detectPhoneRegion();
    regionSelect.value = PHONE_REGION_CONFIG[regionSelect.value] ? regionSelect.value : detected;

    const refresh = () => applyPhoneRegionUI(regionSelect, phoneInput, hintEl, hintMode);
    regionSelect.addEventListener('change', refresh);
    refresh();
    return regionSelect;
  }

  function getPhoneRegionFromSelect(selectId) {
    const sel = document.getElementById(selectId);
    return normalizePhoneRegion(sel?.value || detectPhoneRegion());
  }

  function phoneInvalidMessage(region) {
    const cfg = PHONE_REGION_CONFIG[normalizePhoneRegion(region)];
    if (cfg && typeof global.t === 'function') return global.t(cfg.invalidKey);
    return typeof global.t === 'function' ? global.t('authInvalidPhone') : 'Invalid phone number.';
  }

  global.PHONE_REGION_CONFIG = PHONE_REGION_CONFIG;
  global.phoneDigits = phoneDigits;
  global.isNepaliPhone = isNepaliPhone;
  global.isUsPhone = isUsPhone;
  global.isCanadianPhone = isCanadianPhone;
  global.detectPhoneRegion = detectPhoneRegion;
  global.normalizePhoneRegion = normalizePhoneRegion;
  global.isValidPhoneForRegion = isValidPhoneForRegion;
  global.isValidPhone = isValidPhone;
  global.initPhoneRegionUI = initPhoneRegionUI;
  global.getPhoneRegionFromSelect = getPhoneRegionFromSelect;
  global.phoneInvalidMessage = phoneInvalidMessage;
  global.applyPhoneRegionUI = applyPhoneRegionUI;
})(typeof window !== 'undefined' ? window : globalThis);
