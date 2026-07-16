// Compose flow for a new tracked issue (supervisor-only).
// The menu entry in the topbar is hidden by default; dashboard.js reveals it
// when the current user is a supervisor or superAdmin.

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
  };

  function collect() {
    const out = {};
    for (const [k, el] of Object.entries(fields)) {
      if (!el) continue;
      const v = (el.value || '').trim();
      if (v === '') continue;
      if (k === 'severity') out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  }

  function clear() {
    for (const el of Object.values(fields)) if (el) el.value = '';
    if (feedback) feedback.textContent = '';
  }

  modal.addEventListener('show.bs.modal', clear);

  postBtn.addEventListener('click', async () => {
    const payload = collect();
    if (!payload.summary) {
      feedback.textContent = 'Summary is required.';
      return;
    }
    postBtn.disabled = true;
    feedback.textContent = '';
    try {
      const res = await fetch(`${basePath}/api/tracked-issues`, {
        method: 'POST',
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
      feedback.textContent = err.message || 'Failed to post';
    } finally {
      postBtn.disabled = false;
    }
  });
})();
