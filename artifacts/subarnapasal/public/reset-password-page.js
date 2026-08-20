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

  showAuthError('reset-password', '');

  await withAuthSubmit(form, async () => {
    try {
      if (typeof waitForAuthReady === 'function') {
        await waitForAuthReady();
      }

      const client = typeof getAuthClient === 'function' ? getAuthClient() : null;
      if (!client) {
        showAuthError('reset-password', t('authNotConfigured'));
        return;
      }

      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) {
        showAuthError('reset-password', t('authResetLinkInvalid'));
        return;
      }

      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;

      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      authToast(t('authResetPasswordSuccess'));
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

  if (typeof waitForAuthReady === 'function') {
    await waitForAuthReady();
  }

  const hasRecoveryHash = window.location.hash.includes('access_token');
  const client = typeof getAuthClient === 'function' ? getAuthClient() : null;
  const { data: { session } } = client ? await client.auth.getSession() : { data: { session: null } };
  if (!session?.access_token && !hasRecoveryHash) {
    showAuthError('reset-password', t('authResetLinkInvalid'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initResetPasswordPage();
});
