function showAuthPanel(panel) {
  const loginPanel = document.getElementById('auth-login-panel');
  const signupPanel = document.getElementById('auth-signup-panel');
  if (!loginPanel || !signupPanel) return;

  loginPanel.hidden = panel !== 'login';
  signupPanel.hidden = panel !== 'signup';
  clearAuthErrors();
}

function initLoginPage() {
  if (!isLoginPage()) return;

  initAuthPageLanguage('loginTitle');
  initPhoneRegionUI({
    regionSelectId: 'signup-phone-region',
    phoneInputId: 'signup-phone',
    hintId: 'signup-phone-hint'
  });

  document.getElementById('show-signup-panel')?.addEventListener('click', () => {
    document.getElementById('signup-form')?.reset();
    showAuthPanel('signup');
    initPhoneRegionUI({
      regionSelectId: 'signup-phone-region',
      phoneInputId: 'signup-phone',
      hintId: 'signup-phone-hint'
    });
  });
  document.getElementById('show-login-panel')?.addEventListener('click', () => showAuthPanel('login'));

  const params = new URLSearchParams(window.location.search);
  if (params.get('signup') === '1') {
    showAuthPanel('signup');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
});
