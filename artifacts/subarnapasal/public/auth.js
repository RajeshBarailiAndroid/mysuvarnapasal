/**
 * SubarnaPasal auth adapter for the Laravel (Sanctum) backend.
 *
 * Drop-in replacement for the original Supabase-based public/auth.js.
 * It exposes the exact same window API (getAuthAccessToken, isAuthRequired,
 * waitForAuthReady, ...) that app.js relies on, but talks to the Laravel
 * endpoints (/api/auth/login, /api/auth/me, ...) and keeps the Sanctum
 * bearer token in localStorage.
 */

let authEnabled = false;
let signedInUser = null;
let accountDisplayName = '';

const TOKEN_KEY = 'sp_auth_token';
const LOGIN_PATH = '/login.html';
const APP_PATH = '/';

function tt(key, fallback) {
  try {
    if (typeof t === 'function') {
      const v = t(key);
      if (v && v !== key) return v;
    }
  } catch (_) { /* ignore */ }
  return fallback;
}

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
}

function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) { /* ignore */ }
}

function isLoginPage() {
  return /\/login\.html$/i.test(window.location.pathname);
}

function isResetPasswordPage() {
  return /\/reset-password\.html$/i.test(window.location.pathname);
}

function isForgotPasswordPage() {
  return /\/forgot-password\.html$/i.test(window.location.pathname);
}

function isAppPage() {
  return !isLoginPage() && !isResetPasswordPage() && !isForgotPasswordPage();
}

let loginRedirectPending = false;

function redirectToLogin(query = '') {
  const target = `${LOGIN_PATH}${query}`;
  if (`${window.location.pathname}${window.location.search}` === target) return;
  if (loginRedirectPending) return;
  loginRedirectPending = true;
  window.location.replace(target);
}

function redirectToApp() {
  if (window.location.pathname !== '/' && !/\/index\.html$/i.test(window.location.pathname)) {
    window.location.replace(APP_PATH);
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidPassword(password) {
  const value = String(password || '');
  return value.length >= 6 && value.length <= 128;
}

function showAuthError(formId, message) {
  const el = document.getElementById(`${formId}-error`);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function clearAuthErrors() {
  showAuthError('login', '');
  showAuthError('forgot', '');
  showAuthError('reset-password', '');
  showAuthError('change-password', '');
}

function renderAccountDisplay() {
  const settingsUser = document.getElementById('settings-account-user');
  if (!settingsUser) return;
  const displayName = accountDisplayName;
  settingsUser.textContent = displayName ? `${tt('accountSignedInAs', 'Signed in as')} ${displayName}` : '';
  settingsUser.hidden = !displayName;
}

async function refreshAccountProfile() {
  const token = getStoredToken();
  if (!token) {
    accountDisplayName = '';
    return;
  }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    accountDisplayName = String(data.displayName || '').trim();
    signedInUser = { username: data.username, displayName: accountDisplayName };
    renderAccountDisplay();
  } catch (_) { /* keep current */ }
}

let authReadyResolve;
const authReady = new Promise((resolve) => {
  authReadyResolve = resolve;
});

let appShellRevealed = false;

function revealAppShell() {
  if (appShellRevealed) return;
  appShellRevealed = true;
  clearAppShellFailsafe();
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-ready');
  if (isAppPage()) {
    if (signedInUser) updateAuthUI({ user: signedInUser });
    else if (!authEnabled) {
      document.body.classList.add('auth-signed-in');
      document.body.classList.remove('auth-signed-out');
    }
  }
  const loader = document.getElementById('app-loading');
  if (loader) loader.setAttribute('aria-busy', 'false');
}

function hideAppShellForRedirect() {
  document.body.classList.remove('auth-ready');
  document.body.classList.add('auth-pending');
}

let appShellFailsafeTimer = null;

function scheduleAppShellFailsafe(ms = 10000) {
  if (appShellFailsafeTimer) return;
  appShellFailsafeTimer = window.setTimeout(() => {
    if (document.body.classList.contains('auth-pending')) revealAppShell();
  }, ms);
}

function clearAppShellFailsafe() {
  if (!appShellFailsafeTimer) return;
  window.clearTimeout(appShellFailsafeTimer);
  appShellFailsafeTimer = null;
}

async function initAuth() {
  if (isAppPage()) scheduleAppShellFailsafe();
  try {
    const res = await fetch('/api/auth/config');
    const cfg = await res.json();
    authEnabled = Boolean(cfg.enabled);
    if (!authEnabled) {
      if (isAppPage()) {
        document.body.classList.add('auth-signed-in');
        document.body.classList.remove('auth-signed-out');
      }
      return;
    }

    const token = getStoredToken();
    if (token) {
      try {
        const meRes = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (meRes.ok) {
          const me = await meRes.json();
          accountDisplayName = String(me.displayName || '').trim();
          signedInUser = { username: me.username, displayName: accountDisplayName };
        } else if (meRes.status === 401) {
          setStoredToken(null);
          signedInUser = null;
        }
      } catch (_) {
        // Network hiccup: keep the token and let API calls decide.
        signedInUser = { username: null, displayName: '' };
      }
    }

    if (signedInUser) {
      if (isLoginPage() || isForgotPasswordPage()) {
        redirectToApp();
        return;
      }
      updateAuthUI({ user: signedInUser });
      renderAccountDisplay();
      return;
    }

    if (isAppPage()) {
      hideAppShellForRedirect();
      redirectToLogin();
      return;
    }

    if (isLoginPage() || isResetPasswordPage() || isForgotPasswordPage()) {
      updateAuthUI(null);
    }
  } catch (err) {
    console.warn('Auth init failed:', err);
    if (isAppPage() && authEnabled) {
      hideAppShellForRedirect();
      redirectToLogin();
    }
  } finally {
    if (!isAppPage()) revealAppShell();
    clearAppShellFailsafe();
    authReadyResolve?.();
  }
}

async function getAuthAccessToken() {
  return getStoredToken();
}

function getAuthClient() {
  return null;
}

window.getAuthAccessToken = getAuthAccessToken;
window.getAuthClient = getAuthClient;
window.waitForAuthReady = () => authReady;
window.isAuthRequired = () => authEnabled;
window.isSignedInSync = () => !authEnabled || Boolean(signedInUser);
window.isLoginPage = isLoginPage;
window.isResetPasswordPage = isResetPasswordPage;
window.isForgotPasswordPage = isForgotPasswordPage;
window.redirectToLogin = redirectToLogin;
window.redirectToApp = redirectToApp;
window.clearAuthErrors = clearAuthErrors;
window.authToast = authToast;
window.showAuthError = showAuthError;
window.revealAppShell = revealAppShell;

function updateAuthUI(session) {
  if (!isAppPage()) return;

  signedInUser = session?.user || signedInUser;
  const hasUser = Boolean(session?.user);
  const settingsLogoutBtn = document.getElementById('settings-logout-btn');
  const changePasswordForm = document.getElementById('settings-change-password-form');

  if (hasUser) {
    renderAccountDisplay();
    if (settingsLogoutBtn) settingsLogoutBtn.hidden = false;
    if (changePasswordForm) changePasswordForm.hidden = !authEnabled;
  } else {
    if (settingsLogoutBtn) settingsLogoutBtn.hidden = true;
    if (changePasswordForm) changePasswordForm.hidden = true;
    accountDisplayName = '';
  }

  const canEdit = hasUser || !authEnabled;
  document.body.classList.toggle('auth-signed-in', canEdit);
  document.body.classList.toggle('auth-signed-out', authEnabled && !hasUser);
}

function authToast(msg) {
  if (typeof toast === 'function') {
    toast(msg);
    return;
  }
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(authToast._t);
  authToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

async function handleLoginSubmit(e) {
  e.preventDefault();

  const username = normalizeUsername(document.getElementById('login-username')?.value);
  const password = document.getElementById('login-password')?.value || '';

  if (!isValidUsername(username)) {
    showAuthError('login', tt('authInvalidUsername', 'Enter a valid username.'));
    return;
  }
  if (!isValidPassword(password)) {
    showAuthError('login', tt('authInvalidPassword', 'Password must be at least 6 characters.'));
    return;
  }

  showAuthError('login', '');
  const submitBtn = e.target.querySelector('.auth-submit');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const payload = await res.json().catch(() => ({}));

    if (submitBtn) submitBtn.disabled = false;

    if (!res.ok) {
      showAuthError('login', payload.error || tt('authLoginFailed', 'Login failed.'));
      return;
    }

    if (payload.session?.access_token) {
      setStoredToken(payload.session.access_token);
      signedInUser = payload.session.user || { username };
      await refreshAccountProfile();
      window.location.replace(APP_PATH);
    }
  } catch (err) {
    if (submitBtn) submitBtn.disabled = false;
    showAuthError('login', err.message || tt('authLoginFailed', 'Login failed.'));
  }
}

// Sign-up is a mobile-app-only flow; the web build has no signup form and the
// API rejects web signups (AuthController::signup requires the mobile client header).

async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  if (!authEnabled) return;

  const form = e.target;
  const currentPassword = String(form.elements.currentPassword?.value || '');
  const password = String(form.elements.password?.value || '');
  const confirm = String(form.elements.confirm?.value || '');

  if (!currentPassword) {
    showAuthError('change-password', tt('authCurrentPasswordRequired', 'Enter your current password.'));
    return;
  }
  if (!isValidPassword(password)) {
    showAuthError('change-password', tt('authInvalidPassword', 'Password must be at least 6 characters.'));
    return;
  }
  if (password !== confirm) {
    showAuthError('change-password', tt('authPasswordMismatch', 'Passwords do not match.'));
    return;
  }

  showAuthError('change-password', '');
  const submitBtn = form.querySelector('[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const token = getStoredToken();
    if (!token) {
      showAuthError('change-password', tt('signInRequired', 'Sign in required.'));
      return;
    }

    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, password, confirm })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAuthError('change-password', payload.error || tt('changePasswordFailed', 'Could not change password.'));
      return;
    }

    form.reset();
    authToast(tt('changePasswordSuccess', 'Password updated. Please sign in again.'));
    setStoredToken(null);
    signedInUser = null;
    window.setTimeout(() => redirectToLogin(), 900);
  } catch (err) {
    showAuthError('change-password', err.message || tt('changePasswordFailed', 'Could not change password.'));
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function signOut(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();

  const token = getStoredToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (_) { /* best-effort */ }
  }
  setStoredToken(null);
  signedInUser = null;
  accountDisplayName = '';

  if (authEnabled) {
    redirectToLogin();
    return;
  }
  window.location.reload();
}

function bindAuthEvents() {
  document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
  // Sign-up is mobile-app-only; there is no signup form on the web any more.
  document.getElementById('settings-logout-btn')?.addEventListener('click', (e) => signOut(e));
  document.getElementById('settings-change-password-form')?.addEventListener('submit', handleChangePasswordSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
  bindAuthEvents();
  initAuth();
});
