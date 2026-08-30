// Login page. Sign-up is a mobile-app-only flow — the panel that used to sit
// beside the login form is gone, and the API refuses web signups anyway
// (AuthController::signup requires the mobile client header).
function initLoginPage() {
  if (!isLoginPage()) return;
  initAuthPageLanguage('loginTitle');
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
});
