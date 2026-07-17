// Tracked-issues ticker: a horizontal scrolling marquee that shows Issue
// Summary for each active tracked issue. Loaded on every dashboard page.
//
// Gated by the per-user tracked_issues_ticker flag (see helpers/userFlags.js).
// If the flag is off, this script does nothing — no fetch, no DOM changes.

(() => {
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const container = document.getElementById('issues-ticker');
  const track = document.getElementById('issues-ticker-track');
  if (!container || !track) return;
  const viewport = track.parentElement;
  let tickerSpeedSeconds = 60; // seconds per one viewport-width of scroll

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderChips(list) {
    if (!list || list.length === 0) {
      container.style.display = 'none';
      track.innerHTML = '';
      return;
    }
    const sep = '<span class="issue-chip-sep" aria-hidden="true">&bull;</span>';
    const chips = list
      .map((i) => `<span class="issue-chip" data-id="${escapeHtml(i.id)}" role="button" tabindex="0">${escapeHtml(i.summary)}</span>`)
      .join(sep);
    track.innerHTML = chips;
    container.style.display = '';
    // padding-left:100% on the track (in CSS) starts the content off-screen
    // right; the -100% translate then walks it fully off the left. On loop
    // it re-enters from the right — a natural single-pass marquee, no
    // content duplication.
    track.style.animationDuration = tickerSpeedSeconds + 's';
  }

  async function refresh() {
    try {
      const res = await fetch(`${basePath}/api/tracked-issues`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderChips(data.trackedIssues || []);
    } catch (err) {
      console.warn('issues-ticker: refresh failed', err);
      container.style.display = 'none';
    }
  }

  async function openDetails(id) {
    try {
      const res = await fetch(`${basePath}/api/tracked-issues/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const issue = await res.json();
      showDetailsModal(issue);
    } catch (err) {
      console.warn('issues-ticker: details fetch failed', err);
    }
  }

  function fmt(v) {
    if (v == null || v === '') return '';
    return escapeHtml(v);
  }

  function showDetailsModal(issue) {
    const modalEl = document.getElementById('tracked-issue-details-modal');
    if (!modalEl) {
      // Fall back to an inline dump if the details modal partial isn't on the page.
      alert((issue && issue.summary) || 'Tracked issue');
      return;
    }
    const body = modalEl.querySelector('.tracked-issue-details-body');
    const title = modalEl.querySelector('.tracked-issue-details-title');
    if (title) title.textContent = issue.summary || 'Tracked Issue';
    const rows = [];
    if (issue.incidentDate) rows.push(['Incident Date', issue.incidentDate]);
    if (issue.severity != null) rows.push(['Severity', issue.severity]);
    if (issue.status) rows.push(['Status', issue.status]);
    if (issue.description) rows.push(['Description', issue.description]);
    if (issue.dealerInfo) rows.push(['Required Information from the Dealer', issue.dealerInfo]);
    if (issue.whatToLookFor) rows.push(['What to look for?', issue.whatToLookFor]);
    body.innerHTML = rows
      .map(([label, val]) => `<div class="tracked-issue-details-row"><div class="tracked-issue-details-label">${escapeHtml(label)}</div><div class="tracked-issue-details-value">${fmt(val)}</div></div>`)
      .join('') || '<em>No additional details.</em>';
    // Bootstrap 5 modal is available on the page (see topbar's dropdowns).
    if (window.bootstrap && window.bootstrap.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else {
      modalEl.style.display = 'block';
    }
  }

  track.addEventListener('click', (e) => {
    const chip = e.target.closest('.issue-chip');
    if (chip) openDetails(chip.dataset.id);
  });
  track.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest && e.target.closest('.issue-chip');
    if (chip) { e.preventDefault(); openDetails(chip.dataset.id); }
  });


  async function loadTickerSpeed() {
    try {
      const res = await fetch(`${basePath}/api/settings/trackedIssuesTickerSpeed`);
      if (!res.ok) return;
      const data = await res.json();
      const seconds = Number(data && data.seconds);
      if (Number.isFinite(seconds) && seconds > 0) tickerSpeedSeconds = seconds;
    } catch { /* keep default 60 */ }
  }

  async function init() {
    try {
      const meRes = await fetch(`${basePath}/api/me`);
      if (!meRes.ok) return;
      const me = await meRes.json();
      if (!me || !me.trackedIssuesTicker) return; // per-user gate
      await loadTickerSpeed();
      await refresh();
      window.addEventListener('rcs:ws-update', refresh);
      // Re-run the copy math on resize so the ticker still fills the viewport
      // when the window changes size.
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(refresh, 150);
      });
    } catch (err) {
      console.warn('issues-ticker: init failed', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
