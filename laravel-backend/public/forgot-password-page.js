function showForgotSuccess(message) {
  const el = document.getElementById('forgot-success');
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

async function handleForgotSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const { username, email } = readIdentityFields(form);

  const identityError = validateIdentity(username, email);
  if (identityError) {
    showAuthError('forgot', identityError);
    showForgotSuccess('');
    return;
  }

  showAuthError('forgot', '');
  showForgotSuccess('');

  await withAuthSubmit(form, async () => {
    const { res, payload } = await postAuthJson('/api/auth/forgot-password', { username, email });
    if (!res.ok) {
      showAuthError('forgot', payload.error || t('authLoginFailed'));
      return;
    }

    const message = payload.message || t('authForgotCheckEmail');
    showForgotSuccess(message);
    form.reset();
  });
}

function initForgotPasswordPage() {
  if (typeof isForgotPasswordPage !== 'function' || !isForgotPasswordPage()) return;

  initAuthPageLanguage('authForgotTitle');
  document.getElementById('forgot-form')?.addEventListener('submit', handleForgotSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
  initForgotPasswordPage();
});
