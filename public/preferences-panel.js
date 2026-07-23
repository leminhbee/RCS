// Extracted from public/dashboard.js — self-initializes on the shared
// rcs:user-loaded event dispatched by topbar.js. Skips silently if the
// modal partial isn't included on the current page.

(() => {
const secToMin = (s) => Math.max(0, Math.round((Number(s) || 0) / 60));
const minToSec = (m) => Math.max(0, Math.round(Number(m) || 0) * 60);

async function initPreferencesPanel() {
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const breakInput = document.getElementById('pref-break-input');
  const lunchInput = document.getElementById('pref-lunch-input');
  const saveBtn = document.getElementById('preferences-save-btn');
  const resetBtn = document.getElementById('preferences-reset-btn');
  const feedback = document.getElementById('preferences-feedback');

  let initial = { breakMin: 2, lunchMin: 10 };

  function recomputeDirty() {
    const dirty =
      Number(breakInput.value) !== initial.breakMin ||
      Number(lunchInput.value) !== initial.lunchMin;
    saveBtn.disabled = !dirty;
    resetBtn.disabled = !dirty;
    return dirty;
  }

  async function load() {
    feedback.textContent = '';
    breakInput.disabled = lunchInput.disabled = true;
    try {
      const res = await fetch(`${basePath}/api/me/reminders`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      initial = {
        breakMin: secToMin(data.preferredBreakTimer),
        lunchMin: secToMin(data.preferredLunchTimer),
      };
      breakInput.value = initial.breakMin;
      lunchInput.value = initial.lunchMin;
    } catch {
      feedback.textContent = 'Failed to load preferences.';
      feedback.className = 'settings-feedback text-danger';
    } finally {
      breakInput.disabled = lunchInput.disabled = false;
      recomputeDirty();
    }
  }

  breakInput.addEventListener('input', () => { feedback.textContent = ''; recomputeDirty(); });
  lunchInput.addEventListener('input', () => { feedback.textContent = ''; recomputeDirty(); });

  resetBtn.onclick = () => {
    breakInput.value = initial.breakMin;
    lunchInput.value = initial.lunchMin;
    feedback.textContent = '';
    recomputeDirty();
  };

  saveBtn.onclick = async () => {
    if (!recomputeDirty()) return;
    saveBtn.disabled = resetBtn.disabled = true;
    feedback.textContent = 'Saving...';
    feedback.className = 'settings-feedback';
    try {
      const res = await fetch(`${basePath}/api/me/reminders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredBreakTimer: minToSec(breakInput.value),
          preferredLunchTimer: minToSec(lunchInput.value),
        }),
      });
      if (!res.ok) throw new Error('save failed');
      initial = { breakMin: Number(breakInput.value), lunchMin: Number(lunchInput.value) };
      feedback.textContent = 'Saved.';
      feedback.className = 'settings-feedback text-success';
    } catch {
      feedback.textContent = 'Failed to save.';
      feedback.className = 'settings-feedback text-danger';
    }
    recomputeDirty();
  };

  document.getElementById('preferences-modal').addEventListener('show.bs.modal', load);
}

(() => {
  window.addEventListener('rcs:user-loaded', (e) => {
    if (!document.getElementById('preferences-modal')) return;
    const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
    if (!user) return;
    initPreferencesPanel();
  });
})();
})();
