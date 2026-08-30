function initLoginPage() {
  if (!isLoginPage()) return;

  initAuthPageLanguage('loginTitle');
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
});
