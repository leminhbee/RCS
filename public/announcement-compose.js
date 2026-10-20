// Wires the shared Announcement Compose modal on any page that includes
// `partials/announcement-compose-modal`. Self-initializes on the shared
// rcs:user-loaded event.

(() => {
  window.addEventListener('rcs:user-loaded', (e) => {
    const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
    if (!user || !(user.supervisor || user.superAdmin)) return;
    if (!document.getElementById('announcement-compose-modal')) return;
    if (!window.Announcements || typeof window.Announcements.initCompose !== 'function') return;
    window.Announcements.initCompose({
      modalId: 'announcement-compose-modal',
      titleId: 'announcement-compose-title',
      bodyId: 'announcement-compose-body',
      postBtnId: 'announcement-compose-post-btn',
      feedbackId: 'announcement-compose-feedback',
      onPosted: () => window.dispatchEvent(new CustomEvent('rcs:ws-update')),
    });
  });
})();
