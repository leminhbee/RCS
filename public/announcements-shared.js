// Shared announcement helpers used by both the main dashboard and the
// dedicated Announcements page. Reads window.isSupervisor / window.isSuperAdmin
// (set by the host page's bootstrap before calling these helpers).

(function () {
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
  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  // Entries are either attachments we stored ourselves (objects, served from
  // the dashboard by array position) or legacy Slack permalinks (bare strings)
  // from before we kept local copies. Images render as thumbnails, everything
  // else as a download chip.
  function renderAnnouncementFiles(a) {
    const list = Array.isArray(a && a.fileUrls) ? a.fileUrls : [];
    if (!list.length) return '';
    const items = list.map((f, i) => {
      if (typeof f === 'string') {
        let label = f;
        try { label = decodeURIComponent(f.split('/').pop() || f); } catch {}
        return `<a class="announcement-file-link" href="${escapeHtml(f)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
      }
      const url = `${basePath()}/api/announcements/${encodeURIComponent(a.id)}/files/${i}`;
      const name = String(f.name || 'file');
      if (/^image\//.test(String(f.mimeType || ''))) {
        return `<a class="announcement-file-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${escapeHtml(name)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></a>`;
      }
      const size = formatBytes(Number(f.size));
      const sizeTag = size ? ` <span class="announcement-file-size">${escapeHtml(size)}</span>` : '';
      return `<a class="announcement-file-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(name)}${sizeTag}</a>`;
    }).join('');
    return `<div class="announcement-files">${items}</div>`;
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

  // The server accepts 32MB of JSON body and base64 grows file bytes by ~33%,
  // so the effective raw ceiling is ~24MB per upload. Checked per-file for a
  // friendlier message, then combined.
  const MB = 1024 * 1024;
  const PER_FILE_MAX = 24 * MB;
  const TOTAL_MAX = 24 * MB;
  function formatMb(n) {
    return (n / MB).toFixed(1);
  }
  // Returns a message describing why the selection is unusable, or '' if it's
  // fine.
  function validateAttachments(raw) {
    const oversized = raw.find((f) => f.size > PER_FILE_MAX);
    if (oversized) return `${oversized.name} is ${formatMb(oversized.size)}MB — max 24MB per file.`;
    const total = raw.reduce((n, f) => n + f.size, 0);
    if (total > TOTAL_MAX) return `Attached files total ${formatMb(total)}MB — max 24MB combined.`;
    return '';
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
      // Clear only hides the announcement; Delete removes the row, its
      // acknowledgement history and its attachments for good.
      const deleteBtn = canManage
        ? `<button type="button" class="btn btn-sm btn-danger ann-delete-btn" data-id="${a.id}">Delete</button>`
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
          <div class="d-flex gap-2">${clearBtn}${deleteBtn}</div>
        </div>
        <div class="ann-body">${renderMarkdown(a.body)}</div>${renderAnnouncementFiles(a)}
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

    container.querySelectorAll('.ann-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Permanently delete this announcement? Its acknowledgement history and any attachments are removed too. This cannot be undone.')) return;
        btn.disabled = true;
        try {
          const res = await fetch(`${basePath()}/api/announcements/${btn.dataset.id}/permanent`, { method: 'DELETE' });
          // 404 means someone else already deleted it; the list is simply stale.
          if (!res.ok && res.status !== 404) throw new Error('delete failed');
          if (typeof opts?.onChange === 'function') await opts.onChange();
        } catch {
          btn.disabled = false;
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
    const filesInput = document.getElementById('announcement-compose-files');
    const filesListEl = document.getElementById('announcement-compose-files-list');

    const feedback = document.getElementById(feedbackId);
    const modalEl = document.getElementById(modalId);
    if (!postBtn || !titleInput || !bodyInput || !modalEl) return;
    if (filesInput && filesListEl) {
      // Validate on selection rather than making the user fill in the form and
      // hit Post to discover the upload is too big.
      filesInput.addEventListener('change', () => {
        const raw = Array.from(filesInput.files || []);
        const error = validateAttachments(raw);
        const total = raw.reduce((n, f) => n + f.size, 0);
        filesListEl.textContent = raw.length
          ? `${raw.map((f) => f.name).join(', ')} — ${formatMb(total)}MB total`
          : '';
        filesListEl.className = `small mt-1 ${error ? 'text-danger' : 'text-muted'}`;
        if (feedback) {
          feedback.textContent = error;
          feedback.className = `settings-feedback${error ? ' text-danger' : ''}`;
        }
        // Block the post outright while the selection is over the limit.
        postBtn.disabled = !!error;
      });
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result || '';
          const idx = String(result).indexOf(',');
          resolve(idx >= 0 ? String(result).slice(idx + 1) : '');
        };
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
      });
    }

    // Guard against double-init when both the shared announcement-compose.js
    // and the announcements-page IIFE call this. First caller wins.
    if (modalEl.dataset.rcsComposeInit === '1') return;
    modalEl.dataset.rcsComposeInit = '1';

    // EasyMDE editor for the body textarea, mounted on modal-show and
    // torn down on modal-hide so the underlying textarea stays clean.
    let editor = null;
    function makeEmojiButton() {
      return {
        name: 'emoji',
        className: 'fa fa-smile-o rcs-emoji-toolbar-btn',
        title: 'Emoji',
        action: (ed) => {
          const btn = modalEl.querySelector('.rcs-emoji-toolbar-btn');
          if (window.rcsEmojiPicker && btn) window.rcsEmojiPicker.show(btn, ed);
        },
      };
    }
    function makeCheckListButton() {
      return {
        name: 'check-list',
        className: 'fa fa-check-square-o',
        title: 'Check list',
        action: (ed) => {
          const cm = ed.codemirror;
          const line = cm.getCursor().line;
          const text = cm.getLine(line);
          cm.replaceRange('- [ ] ' + text, { line, ch: 0 }, { line, ch: text.length });
          cm.focus();
        },
      };
    }

    modalEl.addEventListener('show.bs.modal', () => {
      titleInput.value = '';
      bodyInput.value = '';
      // A previous attempt may have left this disabled by an oversized pick.
      postBtn.disabled = false;
      if (feedback) {
        feedback.textContent = '';
        feedback.className = 'settings-feedback';
      }
      setTimeout(() => {
        if (editor || typeof EasyMDE === 'undefined') return;
        editor = new EasyMDE({
          element: bodyInput,
          spellChecker: false,
          status: false,
          minHeight: '100px',
          autoDownloadFontAwesome: true,
          toolbar: [
            'bold', 'italic', 'strikethrough', '|',
            'unordered-list', 'ordered-list', makeCheckListButton(), '|',
            'code', 'quote', 'link', '|',
            makeEmojiButton(), '|',
            'preview',
          ],
        });
      }, 0);
    });
    modalEl.addEventListener('hidden.bs.modal', () => {
      if (editor) {
        try { editor.toTextArea(); } catch {}
        editor = null;
      }
      if (filesInput) filesInput.value = '';
      if (filesListEl) {
        filesListEl.textContent = '';
        filesListEl.className = 'small text-muted mt-1';
      }
      postBtn.disabled = false;
      if (window.rcsEmojiPicker) window.rcsEmojiPicker.hide();
    });

    postBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const body = (editor ? (editor.value() || '') : bodyInput.value).trim();
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
      let files = [];
      try {
        const raw = filesInput ? Array.from(filesInput.files || []) : [];
        // Backstop for the check already run on selection — the input can be
        // repopulated programmatically, and this is the last point before we
        // spend time base64-encoding.
        const attachmentError = validateAttachments(raw);
        if (attachmentError) {
          if (feedback) {
            feedback.textContent = attachmentError;
            feedback.className = 'settings-feedback text-danger';
          }
          postBtn.disabled = false;
          return;
        }
        for (const f of raw) {
          files.push({
            name: f.name,
            mimeType: f.type || 'application/octet-stream',
            base64: await readFileAsBase64(f),
          });
        }
      } catch (err) {
        if (feedback) {
          feedback.textContent = 'Failed to read attached files.';
          feedback.className = 'settings-feedback text-danger';
        }
        postBtn.disabled = false;
        return;
      }
      try {
        const res = await fetch(`${basePath()}/api/announcements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, files }),
        });
        if (!res.ok) {
          // Surface the actual reason. 413 is served with a text body by
          // express, others usually reply with { error }. Fall back to the
          // status text so users see something useful.
          let detail = '';
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => ({}));
            detail = j.error || j.message || '';
          } else {
            const t = await res.text().catch(() => '');
            detail = t.length > 200 ? t.slice(0, 200) + '…' : t;
          }
          if (res.status === 401) {
            if (feedback) {
              feedback.textContent = detail || 'Session expired. Reload the page and sign in again.';
              feedback.className = 'settings-feedback text-danger';
            }
            // Give the user a beat to read, then reload so they go through login.
            setTimeout(() => { location.reload(); }, 2500);
            return;
          }
          if (!detail && res.status === 413) detail = 'Uploaded files are too large for the server (max 24MB combined).';
          if (!detail) detail = `${res.status} ${res.statusText || ''}`.trim();
          if (feedback) {
            feedback.textContent = `Failed to post: ${detail}`;
            feedback.className = 'settings-feedback text-danger';
          }
          return;
        }
        // The announcement is saved either way; slackPosted tells us whether
        // it also reached the Slack channel.
        const result = await res.json().catch(() => ({}));
        const slackFailed = result && result.slackPosted === false;
        if (feedback) {
          if (slackFailed) {
            feedback.textContent = `Saved to the dashboard, but posting to Slack failed${result.slackError ? ': ' + result.slackError : '.'}`;
            feedback.className = 'settings-feedback text-warning';
          } else {
            feedback.textContent = 'Posted.';
            feedback.className = 'settings-feedback text-success';
          }
        }
        if (typeof onPosted === 'function') await onPosted();
        // Leave a Slack failure on screen long enough to read. Don't reopen the
        // compose form on it — the announcement already exists, so re-posting
        // would duplicate it.
        setTimeout(() => bootstrap.Modal.getInstance(modalEl)?.hide(), slackFailed ? 6000 : 400);
      } catch (err) {
        if (feedback) {
          feedback.textContent = `Failed to post: ${err && err.message ? err.message : 'network error'}`;
          feedback.className = 'settings-feedback text-danger';
        }
      } finally {
        postBtn.disabled = false;
      }
    });
  }

  window.Announcements = { escapeHtml, fetchAll, loadList, renderList, initCompose };
})();
