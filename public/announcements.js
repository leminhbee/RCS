(async function () {
  const basePath = location.pathname.split('/').filter(Boolean)[0]
    ? `/${location.pathname.split('/').filter(Boolean)[0]}`
    : '';
  const listEl = document.getElementById('announcement-list');
  const composeBtn = document.getElementById('announcement-page-compose-btn');
  const filterGroup = document.getElementById('announcement-filter');
  let currentFilter = 'active';

  try {
    const res = await fetch(`${basePath}/api/me`);
    const user = await res.json();
    window.isSupervisor = !!user?.supervisor;
    window.isSuperAdmin = !!user?.superAdmin;

    if (user?.name) {
      const initials = user.name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
      const av = document.getElementById('ms-avatar');
      const avLg = document.getElementById('ms-avatar-lg');
      const nm = document.getElementById('ms-profile-name');
      if (av) av.textContent = initials;
      if (avLg) avLg.textContent = initials;
      if (nm) nm.textContent = user.name;
    }
    if (user?.email) {
      const em = document.getElementById('ms-profile-email');
      if (em) em.textContent = user.email;
    }
    if (user?.supervisor) {
      const badge = document.getElementById('ms-profile-badge');
      if (badge) badge.style.display = 'inline-block';
    }
    if (user?.ssoEnabled) {
      const cp = document.getElementById('change-password-link');
      const cpd = document.getElementById('change-password-divider');
      if (cp) cp.style.display = 'none';
      if (cpd) cpd.style.display = 'none';
    }
    if (user?.permissions?.reports) {
      const rn = document.getElementById('reports-nav-link');
      if (rn) rn.style.display = '';
    }
  } catch {}

  if (window.isSupervisor || window.isSuperAdmin) {
    composeBtn.style.display = '';
  }

  function refresh() {
    return window.Announcements.loadList(listEl, { filter: currentFilter, onChange: refresh });
  }

  filterGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    filterGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    refresh();
  });

  window.Announcements.initCompose({
    modalId: 'announcement-compose-modal',
    titleId: 'announcement-compose-title',
    bodyId: 'announcement-compose-body',
    postBtnId: 'announcement-compose-post-btn',
    feedbackId: 'announcement-compose-feedback',
    onPosted: refresh,
  });

  refresh();
})();
