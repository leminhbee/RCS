// Shared announcement helpers used by both the main dashboard and the
// dedicated Announcements page. Reads window.isSupervisor / window.isSuperAdmin
// (set by the host page's bootstrap before calling these helpers).

(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function basePath() {
    // Both /dashboard and /dashboard/announcements.html sit under /dashboard.
    const segs = location.pathname.split('/').filter(Boolean);
    return segs[0] ? `/${segs[0]}` : '';
  }

  async function fetchAll() {
    const res = await fetch(`${basePath()}/api/announcements/all`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    return data.announcements || [];
  }

  function renderList(container, list, opts) {
    const filter = opts?.filter || 'active';
    const canManage = !!(window.isSupervisor || window.isSuperAdmin);
    const filtered = list.filter((a) => {
      if (filter === 'active') return !!a.active;
      if (filter === 'cleared') return !a.active;
      return true;
    });
    if (filtered.length === 0) {
      container.innerHTML = '<p class="text-muted">No announcements to show.</p>';
      return;
    }
    container.innerHTML = filtered.map((a) => {
      const created = a.createdAt ? new Date(a.createdAt).toLocaleString() : '';
      const statusPill = a.active
        ? '<span class="ann-status-active">Active</span>'
        : '<span class="ann-status-cleared">Cleared</span>';
      const ackPill = a.acknowledgedByMe ? '<span class="ann-ack-pill">Acknowledged</span>' : '';
      const clearBtn = canManage && a.active
        ? `<button type="button" class="btn btn-sm btn-outline-danger ann-clear-btn" data-id="${a.id}">Clear</button>`
        : '';
      const supDetails = canManage
        ? `<div class="ann-ack-details">
             <button type="button" class="ann-ack-toggle" data-id="${a.id}">
               Acknowledged ${a.ackCount} / ${a.eligibleCount} — show details
             </button>
             <div class="ann-ack-body" id="ann-ack-body-${a.id}" style="display:none"></div>
           </div>`
        : '';
      return `<div class="announcement-list-item${a.active ? '' : ' cleared'}" data-id="${a.id}">
        <div class="ann-head">
          <div>
            <div class="ann-title">${escapeHtml(a.title)} ${statusPill} ${ackPill}</div>
            <div class="ann-meta">Posted by ${escapeHtml(a.createdByName)} on ${created}</div>
          </div>
          <div>${clearBtn}</div>
        </div>
        <div class="ann-body">${escapeHtml(a.body)}</div>
        ${supDetails}
      </div>`;
    }).join('');

    container.querySelectorAll('.ann-ack-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const target = document.getElementById(`ann-ack-body-${id}`);
        const ann = filtered.find((x) => x.id === id);
        if (!target || !ann) return;
        if (target.style.display === 'none') {
          const ackedList = (ann.acknowledged || []).map((u) => `<li>${escapeHtml(u.name)} <span class="text-muted small">${new Date(u.ackedAt).toLocaleString()}</span></li>`).join('');
          const pendingList = (ann.pending || []).map((u) => `<li>${escapeHtml(u.name)}</li>`).join('');
          target.innerHTML = `
            <div class="row mt-2">
              <div class="col-md-6">
                <h6 class="small mb-1">Pending (${ann.pending?.length || 0})</h6>
                <ul class="small mb-0">${pendingList || '<li class="text-muted">None</li>'}</ul>
              </div>
              <div class="col-md-6">
                <h6 class="small mb-1">Acknowledged (${ann.acknowledged?.length || 0})</h6>
                <ul class="small mb-0">${ackedList || '<li class="text-muted">None</li>'}</ul>
              </div>
            </div>`;
          target.style.display = '';
          btn.textContent = `Acknowledged ${ann.ackCount} / ${ann.eligibleCount} — hide details`;
        } else {
          target.style.display = 'none';
          btn.textContent = `Acknowledged ${ann.ackCount} / ${ann.eligibleCount} — show details`;
        }
      });
    });

    container.querySelectorAll('.ann-clear-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Clear this announcement? Acknowledgement history will be preserved.')) return;
        btn.disabled = true;
        try {
          const res = await fetch(`${basePath()}/api/announcements/${btn.dataset.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('clear failed');
          if (typeof opts?.onChange === 'function') await opts.onChange();
        } catch {
          btn.disabled = false;
        }
      });
    });
  }

  async function loadList(container, opts) {
    container.innerHTML = 'Loading…';
    try {
      const list = await fetchAll();
      renderList(container, list, opts);
    } catch {
      container.innerHTML = '<p class="text-danger">Failed to load announcements.</p>';
    }
  }

  function initCompose({ modalId, titleId, bodyId, postBtnId, feedbackId, onPosted }) {
    const postBtn = document.getElementById(postBtnId);
    const titleInput = document.getElementById(titleId);
    const bodyInput = document.getElementById(bodyId);
    const feedback = document.getElementById(feedbackId);
    const modalEl = document.getElementById(modalId);
    if (!postBtn || !titleInput || !bodyInput || !modalEl) return;

    modalEl.addEventListener('show.bs.modal', () => {
      titleInput.value = '';
      bodyInput.value = '';
      if (feedback) {
        feedback.textContent = '';
        feedback.className = 'settings-feedback';
      }
    });

    postBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const body = bodyInput.value.trim();
      if (!title || !body) {
        if (feedback) {
          feedback.textContent = 'Title and body are required.';
          feedback.className = 'settings-feedback text-danger';
        }
        return;
      }
      postBtn.disabled = true;
      if (feedback) {
        feedback.textContent = 'Posting…';
        feedback.className = 'settings-feedback';
      }
      try {
        const res = await fetch(`${basePath()}/api/announcements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body }),
        });
        if (!res.ok) throw new Error('post failed');
        if (feedback) {
          feedback.textContent = 'Posted.';
          feedback.className = 'settings-feedback text-success';
        }
        if (typeof onPosted === 'function') await onPosted();
        setTimeout(() => bootstrap.Modal.getInstance(modalEl)?.hide(), 400);
      } catch {
        if (feedback) {
          feedback.textContent = 'Failed to post.';
          feedback.className = 'settings-feedback text-danger';
        }
      } finally {
        postBtn.disabled = false;
      }
    });
  }

  window.Announcements = { escapeHtml, fetchAll, loadList, renderList, initCompose };
})();
