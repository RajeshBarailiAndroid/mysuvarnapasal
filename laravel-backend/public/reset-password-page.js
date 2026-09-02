// Reset-password page for the Laravel (Sanctum) backend.
//
// The email link is {FRONTEND_URL}/reset-password.html?token=<64 hex>&email=…
// (see ACCOUNTS-AND-ADMIN.md). The token is read from the query string and
// sent ONLY to our own /api/auth/reset-password; it never goes anywhere else
// and the only redirect afterwards is the constant /login.html.

function resetParamsFromUrl() {
  const qs = new URLSearchParams(window.location.search);
  const token = String(qs.get('token') || '').trim().toLowerCase();
  const email = String(qs.get('email') || '').trim().toLowerCase();
  return { token, email };
}

function resetLinkLooksValid({ token, email }) {
  return /^[0-9a-f]{64}$/.test(token) && email.includes('@');
}

async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const password = String(form.elements.password?.value || '');
  const confirm = String(form.elements.confirm?.value || '');

  const passwordError = validateNewPassword(password, confirm);
  if (passwordError) {
    showAuthError('reset-password', passwordError);
    return;
  }

  const link = resetParamsFromUrl();
  if (!resetLinkLooksValid(link)) {
    showAuthError('reset-password', t('authResetLinkInvalid'));
    return;
  }

  showAuthError('reset-password', '');

  await withAuthSubmit(form, async () => {
    try {
      const { res, payload } = await postAuthJson('/api/auth/reset-password', {
        email: link.email,
        token: link.token,
        password,
        confirm
      });
      if (!res.ok) {
        showAuthError('reset-password', payload.error || t('changePasswordFailed'));
        return;
      }
      // The server revoked every session for the account; make sure this
      // browser does not keep an old token around either.
      try { localStorage.removeItem('sp_auth_token'); } catch (_) { /* ignore */ }
      authToast(t('authResetPasswordSuccess'));
      // Strip the token from the address bar before leaving.
      window.history.replaceState({}, '', '/reset-password.html');
      window.location.replace('/login.html');
    } catch (err) {
      showAuthError('reset-password', err.message || t('changePasswordFailed'));
    }
  });
}

async function initResetPasswordPage() {
  if (typeof isResetPasswordPage !== 'function' || !isResetPasswordPage()) return;

  initAuthPageLanguage('authResetPasswordTitle');
  document.getElementById('reset-password-form')?.addEventListener('submit', handleResetPasswordSubmit);

  if (!resetLinkLooksValid(resetParamsFromUrl())) {
    showAuthError('reset-password', t('authResetLinkInvalid'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initResetPasswordPage();
});
