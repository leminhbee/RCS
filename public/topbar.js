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

  // ---- Global 401 handler ----
  // Any authenticated fetch that comes back 401 means the session expired.
  // Server-side we now return 401 JSON on API routes (see authMiddleware.js)
  // instead of a 302 redirect to /auth/login. Here we intercept every 401,
  // show a one-time banner, and reload so the browser goes through the
  // normal login flow. First-response wins — subsequent 401s are ignored
  // to avoid stacking banners while the reload is in flight.
  let sessionExpiredHandled = false;
  function handleSessionExpired(detail) {
    if (sessionExpiredHandled) return;
    sessionExpiredHandled = true;

    let banner = document.getElementById('rcs-session-expired-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'rcs-session-expired-banner';
      Object.assign(banner.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        zIndex: '9999',
        background: '#b91c1c',
        color: '#ffffff',
        padding: '10px 16px',
        fontWeight: '600',
        textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      });
      document.body.appendChild(banner);
    }
    banner.textContent = detail || 'Session expired. Reloading to sign in…';
    setTimeout(() => { location.reload(); }, 2000);
  }

  const _origFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    const res = await _origFetch(input, init);
    // Only intercept same-origin API responses. Third-party fetches (e.g.
    // Slack file downloads via permalink) shouldn't hijack the page.
    try {
      const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
      const sameOrigin = !urlStr || urlStr.startsWith('/') || urlStr.startsWith(location.origin);
      if (res.status === 401 && sameOrigin) {
        // Clone so callers can still read the body if they want.
        let detail = '';
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.clone().json();
            detail = j && (j.error || j.message) || '';
          }
        } catch {}
        handleSessionExpired(detail);
      }
    } catch {}
    return res;
  };

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
