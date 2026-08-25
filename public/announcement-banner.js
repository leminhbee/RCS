// Renders the announcement banner between the topbar and the tracked-
// issues ticker. Extracted from public/dashboard.js so every page that
// includes partials/announcement-banner picks it up.
//
// Self-initializes on the shared rcs:user-loaded event dispatched by
// topbar.js. Skips silently if the banner container isn't on the page.

(() => {
  const basePath = () => location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');

  let currentAnnouncements = [];
  let isSupervisor = false;
  let isSuperAdmin = false;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdown(v) {
    if (v == null || v === '') return '';
    const emojied = window.rcsEmojiPicker
      ? window.rcsEmojiPicker.renderEmojisInText(String(v))
      : String(v);
    if (window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(emojied, { breaks: true, gfm: true });
    }
    return escapeHtml(emojied);
  }
  // Entries are either attachments we stored ourselves (objects, served from
  // the dashboard by array position) or legacy Slack permalinks (bare strings).
  // The banner is a thin strip, so it stays chips-only; the ack modal has room
  // for image thumbnails and opts in.
  function renderAnnouncementFiles(a, opts) {
    const list = Array.isArray(a && a.fileUrls) ? a.fileUrls : [];
    if (!list.length) return '';
    const thumbs = !!(opts && opts.thumbs);
    const items = list.map((f, i) => {
      if (typeof f === 'string') {
        let label = f;
        try { label = decodeURIComponent(f.split('/').pop() || f); } catch {}
        return `<a class="announcement-file-link" href="${escapeHtml(f)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
      }
      const url = `${basePath()}/api/announcements/${encodeURIComponent(a.id)}/files/${i}`;
      const name = String(f.name || 'file');
      if (thumbs && /^image\//.test(String(f.mimeType || ''))) {
        return `<a class="announcement-file-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(name)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></a>`;
      }
      return `<a class="announcement-file-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
    }).join('');
    return `<div class="announcement-files">${items}</div>`;
  }

  async function fetchAnnouncements() {
    try {
      const res = await fetch(`${basePath()}/api/announcements`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      currentAnnouncements = data.announcements || [];
    } catch {
      currentAnnouncements = [];
    }
    renderAnnouncementBanner();
    maybeShowAckModal();
  }

  function renderAnnouncementBanner() {
    const banner = document.getElementById('announcement-banner');
    if (!banner) return;
    if (currentAnnouncements.length === 0) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }
    const canManage = isSupervisor || isSuperAdmin;
    banner.style.display = '';
    banner.innerHTML = currentAnnouncements.map((a) => {
      const created = a.createdAt ? new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const actions = canManage
        ? `<button class="btn btn-sm btn-outline-secondary announcement-acks-btn" data-id="${a.id}">Ack status</button>
           <button class="btn btn-sm btn-outline-danger announcement-clear-btn" data-id="${a.id}">Clear</button>`
        : (a.acknowledgedByMe
            ? `<span class="announcement-ack-pill">Acknowledged</span>`
            : `<button class="btn btn-sm btn-warning announcement-ack-btn" data-id="${a.id}">Acknowledge</button>`);
      return `<div class="announcement-item">
        <div class="announcement-text">
          <div class="announcement-title">${escapeHtml(a.title)}</div>
          <div class="announcement-body">${renderMarkdown(a.body)}</div>
        </div>
        ${renderAnnouncementFiles(a)}
        <div class="announcement-meta">${created}</div>
        <div class="announcement-actions">${actions}</div>
      </div>`;
    }).join('');

    banner.querySelectorAll('.announcement-ack-btn').forEach((btn) => {
      btn.addEventListener('click', () => ackAnnouncement(btn.dataset.id, btn));
    });
    banner.querySelectorAll('.announcement-clear-btn').forEach((btn) => {
      btn.addEventListener('click', () => clearAnnouncement(btn.dataset.id, btn));
    });
    banner.querySelectorAll('.announcement-acks-btn').forEach((btn) => {
      btn.addEventListener('click', () => showAckStatus(btn.dataset.id));
    });
  }

  function maybeShowAckModal() {
    if (isSupervisor || isSuperAdmin) return;
    const modalEl = document.getElementById('announcement-ack-modal');
    if (!modalEl || !window.bootstrap) return;
    const bodyEl = document.getElementById('announcement-ack-modal-body');
    const unacked = currentAnnouncements.filter((a) => !a.acknowledgedByMe);
    const bsModal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
    if (unacked.length === 0) {
      bsModal.hide();
      return;
    }
    bodyEl.innerHTML = unacked.map((a) => `
      <div class="announcement-item mb-2 pb-2 border-bottom">
        <div class="announcement-text">
          <div class="announcement-title">${escapeHtml(a.title)}</div>
          <div class="announcement-body">${renderMarkdown(a.body)}</div>
          ${renderAnnouncementFiles(a, { thumbs: true })}
        </div>
        <div class="announcement-actions mt-2">
          <button class="btn btn-sm btn-warning announcement-ack-btn" data-id="${a.id}">Acknowledge</button>
        </div>
      </div>`).join('');
    bodyEl.querySelectorAll('.announcement-ack-btn').forEach((btn) => {
      btn.addEventListener('click', () => ackAnnouncement(btn.dataset.id, btn));
    });
    bsModal.show();
  }

  async function ackAnnouncement(id, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`${basePath()}/api/announcements/${id}/ack`, { method: 'POST' });
      if (!res.ok) throw new Error('ack failed');
      await fetchAnnouncements();
    } catch {
      if (btn) btn.disabled = false;
    }
  }

  async function clearAnnouncement(id, btn) {
    if (!confirm('Clear this announcement? Acknowledgement history will be preserved.')) return;
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`${basePath()}/api/announcements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('clear failed');
      await fetchAnnouncements();
    } catch {
      if (btn) btn.disabled = false;
    }
  }

  async function showAckStatus(id) {
    const modalEl = document.getElementById('announcement-acks-modal');
    if (!modalEl || !window.bootstrap) return;
    const bodyEl = document.getElementById('announcement-acks-modal-body');
    const titleEl = document.getElementById('announcement-acks-modal-title');
    const ann = currentAnnouncements.find((a) => a.id === id);
    titleEl.textContent = ann ? `Ack Status — ${ann.title}` : 'Ack Status';
    bodyEl.innerHTML = 'Loading…';
    window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    try {
      const res = await fetch(`${basePath()}/api/announcements/${id}/acks`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const ackedList = (data.acknowledged || []).map((u) => `<li>${escapeHtml(u.name)} <span class="text-muted small">${new Date(u.ackedAt).toLocaleString()}</span></li>`).join('');
      const pendingList = (data.pending || []).map((u) => `<li>${escapeHtml(u.name)}</li>`).join('');
      bodyEl.innerHTML = `
        <div class="row">
          <div class="col-md-6">
            <h6>Pending (${data.pending?.length || 0})</h6>
            <ul class="small">${pendingList || '<li class="text-muted">None</li>'}</ul>
          </div>
          <div class="col-md-6">
            <h6>Acknowledged (${data.acknowledged?.length || 0})</h6>
            <ul class="small">${ackedList || '<li class="text-muted">None</li>'}</ul>
          </div>
        </div>`;
    } catch {
      bodyEl.innerHTML = '<p class="text-danger">Failed to load ack status.</p>';
    }
  }

  window.addEventListener('rcs:user-loaded', (e) => {
    if (!document.getElementById('announcement-banner')) return;
    const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
    isSupervisor = !!(user && user.supervisor);
    isSuperAdmin = !!(user && user.superAdmin);
    fetchAnnouncements();
    // Poll every 30s + refresh on ws-update from any page.
    setInterval(fetchAnnouncements, 30000);
    window.addEventListener('rcs:ws-update', fetchAnnouncements);
  });
})();
