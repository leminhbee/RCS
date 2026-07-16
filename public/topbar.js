// Wiring for elements rendered by views/partials/topbar.ejs.
// Loaded on every page that includes the topbar partial so behavior stays in sync.

(() => {
  const themeMenu = document.getElementById('theme-toggle-menu');
  const themeIcon = document.getElementById('theme-toggle-icon');
  const themeLabel = document.getElementById('theme-toggle-label');

  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    if (themeIcon) themeIcon.innerHTML = dark ? '&#9788;' : '&#9790;'; // show what we'd switch TO
    if (themeLabel) themeLabel.textContent = dark ? 'Light mode' : 'Dark mode';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }

  if (themeMenu) {
    themeMenu.addEventListener('click', (e) => {
      e.preventDefault();
      applyTheme(!document.body.classList.contains('dark'));
    });
  }

  applyTheme(localStorage.getItem('theme') === 'dark');
})();
