// Extracted from public/dashboard.js — self-initializes on the shared
// rcs:user-loaded event dispatched by topbar.js. Skips silently if the
// modal partial isn't included on the current page.

(() => {
const secToMin = (s) => Math.max(0, Math.round((Number(s) || 0) / 60));
const minToSec = (m) => Math.max(0, Math.round(Number(m) || 0) * 60);

async function initUserFlagsPanel() {
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const flagsBody = document.getElementById('user-flags-modal-body');
  const remindersBody = document.getElementById('user-flags-reminders-body');
  const saveBtn = document.getElementById('user-flags-save-btn');
  const resetBtn = document.getElementById('user-flags-reset-btn');
  const feedback = document.getElementById('user-flags-feedback');

  let flags = [];
  let users = [];
  // Each entry: { ...flagKey: bool, breakMin: int, lunchMin: int }.
  let initialById = new Map();
  let currentById = new Map();

  function flagDirty(u, key) { return initialById.get(u.id)[key] !== currentById.get(u.id)[key]; }
  function userHasAnyDirty(u) {
    for (const { key } of flags) if (flagDirty(u, key)) return true;
    return flagDirty(u, 'breakMin') || flagDirty(u, 'lunchMin');
  }

  function recomputeDirty() {
    const dirtyIds = users.filter(userHasAnyDirty).map((u) => u.id);
    saveBtn.disabled = dirtyIds.length === 0;
    resetBtn.disabled = dirtyIds.length === 0;
    return dirtyIds;
  }

  function renderFlagsTab() {
    const headerCells = flags
      .map((f) => `<th class="user-flags-col">
        <span class="user-flags-col-label">${f.label}</span>
        <span class="user-flags-info" tabindex="0" role="button" aria-label="${f.label} info"
          data-bs-toggle="tooltip" data-bs-placement="top" data-bs-title="${f.description}">&#9432;</span>
      </th>`)
      .join('');
    const rowsHtml = users.map((u) => {
      const cur = currentById.get(u.id);
      const cells = flags.map((f) => {
        const dirty = flagDirty(u, f.key);
        return `<td class="user-flags-col text-center${dirty ? ' user-flags-dirty' : ''}">
          <div class="form-check form-switch d-inline-flex" data-bs-toggle="tooltip" data-bs-placement="left" data-bs-title="${f.label}: ${f.description}">
            <input class="form-check-input user-flags-toggle" type="checkbox"
              data-user-id="${u.id}" data-flag-key="${f.key}"${cur[f.key] ? ' checked' : ''}>
          </div>
        </td>`;
      }).join('');
      return `<tr>
        <td class="user-flags-name">${u.name}${u.email ? `<div class="user-flags-email">${u.email}</div>` : ''}</td>
        ${cells}
      </tr>`;
    }).join('');

    flagsBody.innerHTML = `
      <div class="user-flags-table-wrap">
        <table class="table table-sm user-flags-table mb-0">
          <thead>
            <tr><th class="user-flags-name">User</th>${headerCells}</tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    flagsBody.querySelectorAll('.user-flags-toggle').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.userId;
        const key = cb.dataset.flagKey;
        currentById.get(id)[key] = cb.checked;
        cb.closest('td').classList.toggle('user-flags-dirty', flagDirty({ id }, key));
        feedback.textContent = '';
        recomputeDirty();
      });
    });

    flagsBody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
      // eslint-disable-next-line no-undef
      new bootstrap.Tooltip(el);
    });
  }

  function renderRemindersTab() {
    const rowsHtml = users.map((u) => {
      const cur = currentById.get(u.id);
      const breakDirty = flagDirty(u, 'breakMin');
      const lunchDirty = flagDirty(u, 'lunchMin');
      return `<tr>
        <td class="user-flags-name">${u.name}${u.email ? `<div class="user-flags-email">${u.email}</div>` : ''}</td>
        <td class="user-flags-col text-center${breakDirty ? ' user-flags-dirty' : ''}">
          <input type="number" min="0" step="1" class="form-control form-control-sm user-flags-num user-flags-reminder"
            data-user-id="${u.id}" data-reminder-key="breakMin" value="${cur.breakMin}">
        </td>
        <td class="user-flags-col text-center${lunchDirty ? ' user-flags-dirty' : ''}">
          <input type="number" min="0" step="1" class="form-control form-control-sm user-flags-num user-flags-reminder"
            data-user-id="${u.id}" data-reminder-key="lunchMin" value="${cur.lunchMin}">
        </td>
      </tr>`;
    }).join('');

    remindersBody.innerHTML = `
      <div class="user-flags-table-wrap">
        <table class="table table-sm user-flags-table mb-0">
          <thead>
            <tr>
              <th class="user-flags-name">User</th>
              <th class="user-flags-col text-center">Break Reminder (min)</th>
              <th class="user-flags-col text-center">Lunch Reminder (min)</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    remindersBody.querySelectorAll('.user-flags-reminder').forEach((input) => {
      input.addEventListener('input', () => {
        const id = input.dataset.userId;
        const key = input.dataset.reminderKey;
        const n = Math.max(0, Math.round(Number(input.value) || 0));
        currentById.get(id)[key] = n;
        input.closest('td').classList.toggle('user-flags-dirty', flagDirty({ id }, key));
        feedback.textContent = '';
        recomputeDirty();
      });
    });
  }

  function renderAll() { renderFlagsTab(); renderRemindersTab(); }

  async function load() {
    flagsBody.innerHTML = '<p class="p-3">Loading...</p>';
    remindersBody.innerHTML = '<p class="p-3">Loading...</p>';
    feedback.textContent = '';
    try {
      const res = await fetch(`${basePath}/api/users/flags`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      flags = data.flags || [];
      users = data.users || [];
      initialById = new Map();
      currentById = new Map();
      for (const u of users) {
        const snap = {};
        for (const { key } of flags) snap[key] = !!u[key];
        snap.breakMin = secToMin(u.preferredBreakTimer);
        snap.lunchMin = secToMin(u.preferredLunchTimer);
        initialById.set(u.id, { ...snap });
        currentById.set(u.id, { ...snap });
      }
      renderAll();
      recomputeDirty();
    } catch {
      flagsBody.innerHTML = '<p class="p-3 text-danger">Failed to load user permissions.</p>';
      remindersBody.innerHTML = '';
    }
  }

  resetBtn.onclick = () => {
    for (const u of users) currentById.set(u.id, { ...initialById.get(u.id) });
    feedback.textContent = '';
    renderAll();
    recomputeDirty();
  };

  saveBtn.onclick = async () => {
    const dirtyIds = recomputeDirty();
    if (dirtyIds.length === 0) return;
    saveBtn.disabled = true;
    resetBtn.disabled = true;
    feedback.textContent = `Saving ${dirtyIds.length} user${dirtyIds.length === 1 ? '' : 's'}...`;
    feedback.className = 'settings-feedback';

    const failures = [];
    for (const id of dirtyIds) {
      const init = initialById.get(id);
      const cur = currentById.get(id);

      // Split into two patches: boolean flags vs reminder seconds.
      const flagPatch = {};
      for (const { key } of flags) if (init[key] !== cur[key]) flagPatch[key] = cur[key];

      const reminderPatch = {};
      if (init.breakMin !== cur.breakMin) reminderPatch.preferredBreakTimer = minToSec(cur.breakMin);
      if (init.lunchMin !== cur.lunchMin) reminderPatch.preferredLunchTimer = minToSec(cur.lunchMin);

      try {
        if (Object.keys(flagPatch).length > 0) {
          const r = await fetch(`${basePath}/api/users/${id}/flags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flagPatch),
          });
          if (!r.ok) throw new Error(`flags ${r.status}`);
        }
        if (Object.keys(reminderPatch).length > 0) {
          const r = await fetch(`${basePath}/api/users/${id}/reminders`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reminderPatch),
          });
          if (!r.ok) throw new Error(`reminders ${r.status}`);
        }
        initialById.set(id, { ...cur });
      } catch (err) {
        failures.push(id);
      }
    }

    if (failures.length === 0) {
      feedback.textContent = 'Saved.';
      feedback.className = 'settings-feedback text-success';
    } else {
      feedback.textContent = `Saved with ${failures.length} failure${failures.length === 1 ? '' : 's'} — see network log.`;
      feedback.className = 'settings-feedback text-danger';
    }
    renderAll();
    recomputeDirty();
  };

  document.getElementById('user-flags-modal').addEventListener('show.bs.modal', load);
  load();
}

(() => {
  window.addEventListener('rcs:user-loaded', (e) => {
    if (!document.getElementById('user-flags-modal')) return;
    const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
    if (!user || !(user.supervisor || user.superAdmin)) return;
    initUserFlagsPanel();
  });
})();
})();
