(async function () {
  const basePath = location.pathname.split('/').filter(Boolean)[0]
    ? `/${location.pathname.split('/').filter(Boolean)[0]}`
    : '';
  const listEl = document.getElementById('announcement-list');
  const composeBtn = document.getElementById('announcement-page-compose-btn');
  const filterGroup = document.getElementById('announcement-filter');
  let currentFilter = 'active';

  try {
    // Topbar hydration lives in topbar.js — just read the resolved user.
    const user = await window.rcs.userPromise;
    window.isSupervisor = !!user?.supervisor;
    window.isSuperAdmin = !!user?.superAdmin;
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
