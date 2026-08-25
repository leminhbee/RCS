// Compose / edit flow for a tracked issue (supervisor-only).
// The description / dealerInfo / whatToLookFor fields use EasyMDE, mounted
// on the underlying textareas on modal-open and torn down on modal-close.

(() => {
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const modal = document.getElementById('tracked-issue-compose-modal');
  const postBtn = document.getElementById('tracked-issue-compose-post');
  const feedback = document.getElementById('tracked-issue-compose-feedback');
  if (!modal || !postBtn) return;

  const fields = {
    summary: document.getElementById('tracked-issue-summary'),
    incidentDate: document.getElementById('tracked-issue-incident-date'),
    severity: document.getElementById('tracked-issue-severity'),
    status: document.getElementById('tracked-issue-status'),
    description: document.getElementById('tracked-issue-description'),
    dealerInfo: document.getElementById('tracked-issue-dealer-info'),
    whatToLookFor: document.getElementById('tracked-issue-what-to-look-for'),
    state: document.getElementById('tracked-issue-state'),
  };
  const editIdInput = document.getElementById('tracked-issue-edit-id');
  const titleEl = document.getElementById('tracked-issue-compose-title');
  const RICH = ['description', 'dealerInfo', 'whatToLookFor'];
  const editors = {};

  function makeEmojiButton() {
    return {
      name: 'emoji',
      className: 'fa fa-smile-o rcs-emoji-toolbar-btn',
      title: 'Emoji',
      action: (editor) => {
        const btn = document.querySelector('.rcs-emoji-toolbar-btn');
        if (window.rcsEmojiPicker && btn) window.rcsEmojiPicker.show(btn, editor);
      },
    };
  }
  function makeCheckListButton() {
    return {
      name: 'check-list',
      className: 'fa fa-check-square-o',
      title: 'Check list',
      action: (editor) => {
        const cm = editor.codemirror;
        const line = cm.getCursor().line;
        const text = cm.getLine(line);
        cm.replaceRange('- [ ] ' + text, { line, ch: 0 }, { line, ch: text.length });
        cm.focus();
      },
    };
  }

  function mountEditors() {
    if (typeof EasyMDE === 'undefined') return;
    for (const key of RICH) {
      const el = fields[key];
      if (!el || editors[key]) continue;
      editors[key] = new EasyMDE({
        element: el,
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
    }
  }
  function unmountEditors() {
    for (const key of Object.keys(editors)) {
      try { editors[key].toTextArea(); } catch {}
      delete editors[key];
    }
  }
  function syncEditorsFromTextareas() {
    for (const key of RICH) {
      const ed = editors[key];
      const el = fields[key];
      if (ed && el) ed.value(el.value || '');
    }
  }

  function collect() {
    const editing = !!(editIdInput && editIdInput.value);
    const out = {};
    for (const [k, el] of Object.entries(fields)) {
      if (!el) continue;
      let v;
      if (RICH.includes(k) && editors[k]) v = (editors[k].value() || '').trim();
      else v = (el.value || '').trim();
      if (v === '') {
        if (editing) out[k] = null;
        continue;
      }
      if (k === 'severity') out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  }

  function clearFields() {
    for (const el of Object.values(fields)) if (el) el.value = '';
    for (const key of RICH) { if (editors[key]) editors[key].value(''); }
    if (fields.state) fields.state.value = 'open';
    if (feedback) feedback.textContent = '';
  }

  function applyMode() {
    const editing = !!(editIdInput && editIdInput.value);
    if (titleEl) titleEl.textContent = editing ? 'Edit Tracked Issue' : 'New Tracked Issue';
    if (postBtn) postBtn.textContent = editing ? 'Save' : 'Post';
  }

  modal.addEventListener('show.bs.modal', () => {
    const editing = !!(editIdInput && editIdInput.value);
    if (!editing) clearFields();
    applyMode();
    setTimeout(() => {
      mountEditors();
      syncEditorsFromTextareas();
    }, 0);
  });
  modal.addEventListener('hidden.bs.modal', () => {
    unmountEditors();
    if (editIdInput) editIdInput.value = '';
    clearFields();
    applyMode();
    if (window.rcsEmojiPicker) window.rcsEmojiPicker.hide();
  });

  window.rcs = window.rcs || {};
  window.rcs.trackedIssuesCompose = { syncFromTextareas: syncEditorsFromTextareas };

  postBtn.addEventListener('click', async () => {
    const payload = collect();
    if (!payload.summary) {
      feedback.textContent = 'Summary is required.';
      return;
    }
    postBtn.disabled = true;
    feedback.textContent = '';
    const editing = !!(editIdInput && editIdInput.value);
    const url = editing
      ? `${basePath}/api/tracked-issues/${encodeURIComponent(editIdInput.value)}`
      : `${basePath}/api/tracked-issues`;
    const method = editing ? 'PATCH' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        feedback.textContent = err.error || `HTTP ${res.status}`;
        return;
      }
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modal).hide();
      }
      window.dispatchEvent(new CustomEvent('rcs:ws-update'));
    } catch (err) {
      feedback.textContent = err.message || 'Failed to save';
    } finally {
      postBtn.disabled = false;
    }
  });
})();
