function initAuthPageLanguage(titleKey) {
  setLanguage(currentLang);
  applyStaticI18n();
  document.title = `${t(titleKey)} — Suvarnapasal`;

  const langSelect = document.getElementById('language-select');
  if (langSelect) langSelect.value = currentLang;

  langSelect?.addEventListener('change', (e) => {
    setLanguage(e.target.value);
    applyStaticI18n();
    document.title = `${t(titleKey)} — Suvarnapasal`;
    if (langSelect) langSelect.value = currentLang;
    const regionSel = document.getElementById('signup-phone-region');
    if (regionSel && typeof applyPhoneRegionUI === 'function') {
      applyPhoneRegionUI(regionSel, document.getElementById('signup-phone'), document.getElementById('signup-phone-hint'));
    }
  });
}

function readIdentityFields(form) {
  return {
    username: normalizeUsername(form.elements.username?.value),
    email: String(form.elements.email?.value || '').trim()
  };
}

function validateIdentity(username, email) {
  if (!isValidUsername(username)) return t('authInvalidUsername');
  if (!email || !isValidEmail(email)) return t('authInvalidEmail');
  return '';
}

function validateNewPassword(password, confirm) {
  if (!isValidPassword(password)) return t('authInvalidPassword');
  if (password !== confirm) return t('authPasswordMismatch');
  return '';
}

async function withAuthSubmit(form, handler) {
  const submitBtn = form.querySelector('.auth-submit');
  if (submitBtn) submitBtn.disabled = true;
  try {
    return await handler();
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function postAuthJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}
