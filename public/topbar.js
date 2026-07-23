// Wiring for elements rendered by views/partials/topbar.ejs.
// Loaded on every dashboard page. Single source of truth for:
//   - theme toggle
//   - fetching /api/me
//   - populating the profile card (avatar, name, email, Supervisor badge)
//   - hiding change-password on SSO users
//   - revealing nav links (Reports, Tracked Issues) per user permissions
//   - revealing admin-only menu rows IFF their target modal exists on the
//     current page (so we never surface a menu item that opens nothing)
//
// Exposes:
//   window.rcs.userPromise — resolves with the user object (or null on failure)
//   window.rcs.currentUser — populated once the promise resolves
//   window: 'rcs:user-loaded' event dispatched with `detail: user` on success
//
// Any page-specific JS should `await window.rcs.userPromise` instead of
// fetching /api/me itself.

(() => {
  window.rcs = window.rcs || {};

  // ---- theme toggle (unchanged behavior) ----
  const themeMenu = document.getElementById('theme-toggle-menu');
  const themeIcon = document.getElementById('theme-toggle-icon');
  const themeLabel = document.getElementById('theme-toggle-label');

  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    if (themeIcon) themeIcon.innerHTML = dark ? '&#9788;' : '&#9790;';
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

  // ---- profile hydration ----
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');

  function hydrate(user) {
    if (!user || typeof user !== 'object') return;

    if (user.name) {
      const initials = user.name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
      const av = document.getElementById('ms-avatar');
      const avLg = document.getElementById('ms-avatar-lg');
      const nm = document.getElementById('ms-profile-name');
      if (av) av.textContent = initials;
      if (avLg) avLg.textContent = initials;
      if (nm) nm.textContent = user.name;
    }
    if (user.email) {
      const em = document.getElementById('ms-profile-email');
      if (em) em.textContent = user.email;
    }
    if (user.supervisor) {
      const badge = document.getElementById('ms-profile-badge');
      if (badge) badge.style.display = 'inline-block';
    }
    if (user.ssoEnabled) {
      const cp = document.getElementById('change-password-link');
      const cpd = document.getElementById('change-password-divider');
      if (cp) cp.style.display = 'none';
      if (cpd) cpd.style.display = 'none';
    }

    // Nav links
    if (user.permissions && user.permissions.reports) {
      const rn = document.getElementById('reports-nav-link');
      if (rn) rn.style.display = '';
    }
    if (user.trackedIssuesTicker || user.supervisor || user.superAdmin) {
      const tiNav = document.getElementById('tracked-issues-nav-link');
      if (tiNav) tiNav.style.display = '';
    }

    // Admin-only profile-menu rows. Only reveal if the row's target modal
    // exists on the current page — otherwise clicking would open nothing.
    const isSupervisor = !!user.supervisor;
    const isSuperAdmin = !!user.superAdmin;
    const rows = [
      { id: 'announcement-menu',  requires: () => isSupervisor || isSuperAdmin },
      { id: 'tracked-issue-menu', requires: () => isSupervisor || isSuperAdmin },
      { id: 'user-flags-menu',    requires: () => isSupervisor || isSuperAdmin },
      { id: 'settings-menu',      requires: () => isSuperAdmin },
    ];
    let anyRevealed = false;
    for (const r of rows) {
      const el = document.getElementById(r.id);
      if (!el || !r.requires()) continue;
      const targetSel = el.getAttribute('data-bs-target');
      if (targetSel && !document.querySelector(targetSel)) continue; // modal not on this page
      el.style.display = '';
      anyRevealed = true;
    }
    if (anyRevealed) {
      const divider = document.getElementById('admin-menu-divider');
      if (divider) divider.style.display = '';
    }
  }

  window.rcs.userPromise = (async () => {
    try {
      const res = await fetch(`${basePath}/api/me`);
      if (!res.ok) return null;
      const user = await res.json();
      window.rcs.currentUser = user;
      hydrate(user);
      window.dispatchEvent(new CustomEvent('rcs:user-loaded', { detail: user }));
      return user;
    } catch (err) {
      console.warn('topbar: failed to hydrate profile', err);
      return null;
    }
  })();
})();
