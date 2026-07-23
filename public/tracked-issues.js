// Tracked Issues management page.
//
// - Gate: user needs the trackedIssuesTicker flag OR supervisor/superAdmin.
// - Read: everyone in-scope; supervisors also get Edit / Close / Reopen
//   controls and the "+ New Tracked Issue" button in the header.
// - Client-side filter: Active / Resolved / All.
// - Refreshes on the same rcs:ws-update custom event dashboard.js broadcasts.

(async function () {
  const basePath = location.pathname.split('/').filter(Boolean)[0]
    ? `/${location.pathname.split('/').filter(Boolean)[0]}`
    : '';
  const listEl = document.getElementById('tracked-issue-list');
  const composeBtn = document.getElementById('tracked-issue-page-compose-btn');
  const filterGroup = document.getElementById('tracked-issue-filter');
  let currentFilter = 'active';
  let issues = [];
  let isSupervisor = false;
  let isSuperAdmin = false;
  let hasAccess = false;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  try {
    // Topbar hydration lives in topbar.js — just read the resolved user.
    const user = await window.rcs.userPromise;
    if (!user) return;
    isSupervisor = !!user.supervisor;
    isSuperAdmin = !!user.superAdmin;
    hasAccess = !!(user.trackedIssuesTicker || isSupervisor || isSuperAdmin);
  } catch {
    listEl.textContent = 'Failed to load session.';
    return;
  }

  if (!hasAccess) {
    listEl.innerHTML = '<div class="empty">You do not have access to Tracked Issues.</div>';
    return;
  }
  if (isSupervisor || isSuperAdmin) {
    composeBtn.style.display = '';
  }

  filterGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    filterGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });

  async function refresh() {
    try {
      const res = await fetch(`${basePath}/api/tracked-issues/all`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      issues = data.trackedIssues || [];
      render();
    } catch (err) {
      listEl.textContent = 'Failed to load tracked issues.';
      console.warn('tracked-issues page: refresh failed', err);
    }
  }

  function filtered() {
    const withoutTemplate = issues.filter((i) => !isTemplateRow(i));
    if (currentFilter === 'active') return withoutTemplate.filter((i) => i.state !== 'resolved');
    if (currentFilter === 'resolved') return withoutTemplate.filter((i) => i.state === 'resolved');
    if (currentFilter === 'fix_incoming') return withoutTemplate.filter((i) => i.state === 'fix_incoming');
    return withoutTemplate;
  }

  function isTemplateRow(i) {
    return typeof i.summary === 'string' && i.summary.trim().toLowerCase() === 'template';
  }

  function render() {
    const list = filtered();
    if (!list.length) {
      listEl.innerHTML = '<div class="empty">No tracked issues.</div>';
      return;
    }
    listEl.innerHTML = list.map(rowHtml).join('');
  }

  function stateLabel(st) {
    if (st === 'fix_incoming') return 'Fix Incoming';
    if (st === 'resolved') return 'Resolved';
    return 'Open';
  }
  function stateBadgeClass(st) {
    if (st === 'fix_incoming') return 'state-badge state-fix-incoming';
    if (st === 'resolved') return 'state-badge state-resolved';
    return 'state-badge state-open';
  }

  function rowHtml(i) {
    const st = i.state || (i.active ? 'open' : 'resolved');
    const badge = `<span class="${stateBadgeClass(st)}">${stateLabel(st)}</span>`;
    const meta = [];
    if (i.incidentDate) meta.push(`Incident: ${escapeHtml(i.incidentDate)}`);
    if (i.severity != null) meta.push(`Sev ${escapeHtml(i.severity)}`);
    if (i.status) meta.push(`Status: ${escapeHtml(i.status)}`);
    const canEdit = isSupervisor || isSuperAdmin;
    // State-transition buttons: only show transitions that make sense from the
    // current state. Edit always available; Delete always available (hard-remove).
    let transitions = '';
    if (st === 'open') {
      transitions = `
        <button type="button" class="btn btn-outline-success btn-sm" data-action="state" data-state="fix_incoming" data-id="${escapeHtml(i.id)}">Fix Incoming</button>
        <button type="button" class="btn btn-outline-warning btn-sm" data-action="state" data-state="resolved" data-id="${escapeHtml(i.id)}">Close</button>`;
    } else if (st === 'fix_incoming') {
      transitions = `
        <button type="button" class="btn btn-outline-secondary btn-sm" data-action="state" data-state="open" data-id="${escapeHtml(i.id)}">Mark Open</button>
        <button type="button" class="btn btn-outline-warning btn-sm" data-action="state" data-state="resolved" data-id="${escapeHtml(i.id)}">Close</button>`;
    } else {
      transitions = `
        <button type="button" class="btn btn-outline-success btn-sm" data-action="state" data-state="open" data-id="${escapeHtml(i.id)}">Reopen</button>`;
    }
    const actions = canEdit ? `
      <div class="tracked-issue-actions">
        <button type="button" class="btn btn-outline-primary btn-sm" data-action="edit" data-id="${escapeHtml(i.id)}">Edit</button>
        ${transitions}
        <button type="button" class="btn btn-outline-danger btn-sm" data-action="delete" data-id="${escapeHtml(i.id)}">Delete</button>
      </div>` : '';
    const detailRows = [];
    if (i.description) detailRows.push(['Description of Issue', i.description]);
    if (i.dealerInfo) detailRows.push(['Required Information from the Dealer', i.dealerInfo]);
    if (i.whatToLookFor) detailRows.push(['What to look for?', i.whatToLookFor]);
    const details = detailRows.length
      ? detailRows.map(([lbl, val]) => `<div class="tracked-issue-details-row"><div class="tracked-issue-details-label">${escapeHtml(lbl)}</div><div class="tracked-issue-details-value">${renderMarkdown(val)}</div></div>`).join('')
      : '<em>No additional details.</em>';
    return `
      <div class="tracked-issue-card${st === 'resolved' ? ' cleared' : ''}" data-id="${escapeHtml(i.id)}">
        <div class="tracked-issue-head">
          <div class="tracked-issue-summary">${escapeHtml(i.summary)}</div>
          ${badge}
        </div>
        ${meta.length ? `<div class="tracked-issue-meta">${meta.join('  ·  ')}</div>` : ''}
        <div class="tracked-issue-body" hidden>${details}</div>
        ${actions}
      </div>`;
  }

  // Delegate clicks: row body toggle + action buttons.
  listEl.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('button[data-action]');
    if (actionBtn) {
      const id = actionBtn.dataset.id;
      const action = actionBtn.dataset.action;
      if (action === 'edit') {
        const issue = issues.find((i) => i.id === id);
        if (issue) openEditModal(issue);
      } else if (action === 'state') {
        const newState = actionBtn.dataset.state;
        if (newState === 'resolved') {
          if (!confirm('Close this tracked issue? It will be hidden from the ticker.')) return;
        }
        await patchState(id, newState);
      } else if (action === 'delete') {
        const issue = issues.find((i) => i.id === id);
        const label = issue ? issue.summary : 'this tracked issue';
        if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
        await destroyIssue(id);
      }
      return;
    }
    const card = e.target.closest('.tracked-issue-card');
    if (!card) return;
    const body = card.querySelector('.tracked-issue-body');
    if (body) body.hidden = !body.hidden;
  });

  async function patchState(id, state) {
    try {
      const res = await fetch(`${basePath}/api/tracked-issues/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `Failed to update state (HTTP ${res.status})`);
        return;
      }
      refresh();
    } catch (e) {
      alert(e.message || 'Failed to update state');
    }
  }

  async function patchActive(id, active) {
    try {
      const res = await fetch(`${basePath}/api/tracked-issues/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `Failed: HTTP ${res.status}`);
        return;
      }
      // Local update for snappy UI; ws-update will follow.
      const idx = issues.findIndex((i) => i.id === id);
      if (idx !== -1) issues[idx].active = active;
      render();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  }

  async function destroyIssue(id) {
    try {
      const res = await fetch(`${basePath}/api/tracked-issues/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `Failed: HTTP ${res.status}`);
        return;
      }
      issues = issues.filter((i) => i.id !== id);
      render();
    } catch (err) {
      alert(err.message || 'Failed');
    }
  }

  function openEditModal(issue) {
    const editIdInput = document.getElementById('tracked-issue-edit-id');
    const summary = document.getElementById('tracked-issue-summary');
    const incidentDate = document.getElementById('tracked-issue-incident-date');
    const severity = document.getElementById('tracked-issue-severity');
    const status = document.getElementById('tracked-issue-status');
    const description = document.getElementById('tracked-issue-description');
    const dealerInfo = document.getElementById('tracked-issue-dealer-info');
    const whatToLookFor = document.getElementById('tracked-issue-what-to-look-for');
    const modalEl = document.getElementById('tracked-issue-compose-modal');
    if (!modalEl || !editIdInput) return;
    editIdInput.value = issue.id;
    if (summary) summary.value = issue.summary || '';
    if (incidentDate) incidentDate.value = issue.incidentDate || '';
    if (severity) severity.value = issue.severity != null ? String(issue.severity) : '';
    if (status) status.value = issue.status || '';
    if (description) description.value = issue.description || '';
    if (dealerInfo) dealerInfo.value = issue.dealerInfo || '';
    if (whatToLookFor) whatToLookFor.value = issue.whatToLookFor || '';
    const stateSelect = document.getElementById('tracked-issue-state');
    if (stateSelect) stateSelect.value = issue.state || (issue.active ? 'open' : 'resolved');
    if (window.bootstrap && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
    // Editors mount on show.bs.modal via setTimeout(0); this runs after that
    // tick, so the editors reflect the freshly-populated textarea values.
    setTimeout(() => {
      if (window.rcs && window.rcs.trackedIssuesCompose) {
        window.rcs.trackedIssuesCompose.syncFromTextareas();
      }
    }, 0);
  }

  window.addEventListener('rcs:ws-update', refresh);
  refresh();
})();
