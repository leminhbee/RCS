// Extracted from public/dashboard.js — self-initializes on the shared
// rcs:user-loaded event dispatched by topbar.js. Skips silently if the
// modal partial isn't included on the current page.

(() => {
const secToMin = (s) => Math.max(0, Math.round((Number(s) || 0) / 60));
const minToSec = (m) => Math.max(0, Math.round(Number(m) || 0) * 60);

async function initSettingsPanel() {
  const basePath = location.pathname.replace(/\/$/, '').replace(/\/[^/]+\.html$/, '');
  const body = document.getElementById('settings-modal-body');
  const saveBtn = document.getElementById('settings-save-btn');
  const feedback = document.getElementById('settings-feedback');

  let config = {};
  let userList = [];
  let featureTiers = {};
  let bufferMin = 2;
  let tickerSeconds = 60;
  // Channels stored as an array to preserve display order and allow duplicate-name detection while editing.
  let channels = [];

  try {
    const [visRes, bufRes, chanRes, tickerRes] = await Promise.all([
      fetch(`${basePath}/api/settings/visibility`),
      fetch(`${basePath}/api/settings/breakLateBuffer`),
      fetch(`${basePath}/api/settings/channels`),
      fetch(`${basePath}/api/settings/trackedIssuesTickerSpeed`),
    ]);
    const data = await visRes.json();
    config = data.config || {};
    userList = data.users || [];
    featureTiers = data.featureTiers || {};
    if (bufRes.ok) {
      const bufData = await bufRes.json();
      bufferMin = secToMin(bufData.seconds);
    }
    if (chanRes.ok) {
      const chanData = await chanRes.json();
      channels = Object.entries(chanData.channels || {}).map(([name, id]) => ({ name, id }));
    }
    if (tickerRes && tickerRes.ok) {
      const tickerData = await tickerRes.json();
      if (Number.isFinite(tickerData.seconds)) tickerSeconds = tickerData.seconds;
    }
  } catch {
    body.innerHTML = '<p class="p-3 text-danger">Failed to load settings.</p>';
    return;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function channelRowHtml(c, i) {
    return `
      <div class="settings-channel-row" data-idx="${i}">
        <input type="text" class="form-control form-control-sm settings-channel-name" data-idx="${i}" value="${escapeAttr(c.name)}">
        <input type="text" class="form-control form-control-sm settings-channel-id" data-idx="${i}" value="${escapeAttr(c.id)}">
        <button type="button" class="btn btn-outline-danger btn-sm settings-channel-remove" data-idx="${i}" aria-label="Remove">&times;</button>
      </div>`;
  }

  function refreshChannelsList() {
    const list = body.querySelector('#settings-channels-list');
    if (!list) return;
    list.innerHTML = channels.map((c, i) => channelRowHtml(c, i)).join('');
    bindChannelRowEvents();
  }

  function bindChannelRowEvents() {
    body.querySelectorAll('.settings-channel-name').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.idx);
        if (Number.isFinite(idx) && channels[idx]) {
          channels[idx].name = input.value;
          feedback.textContent = '';
        }
      });
    });
    body.querySelectorAll('.settings-channel-id').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.idx);
        if (Number.isFinite(idx) && channels[idx]) {
          channels[idx].id = input.value;
          feedback.textContent = '';
        }
      });
    });
    body.querySelectorAll('.settings-channel-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (!Number.isFinite(idx)) return;
        channels.splice(idx, 1);
        refreshChannelsList();
        feedback.textContent = '';
      });
    });
  }

  function renderSettingsForm() {
    let html = `
      <div class="settings-feature-row">
        <div class="settings-feature-label">Break Late Notification Buffer</div>
        <div class="preferences-input-wrap">
          <input type="number" min="0" step="1" class="form-control form-control-sm" id="settings-buffer-input" value="${bufferMin}">
          <span class="preferences-unit">min</span>
        </div>
        <div class="preferences-hint">After a break exceeds its time limit, wait this many minutes before sending Slack notifications. Lateness is still recorded at the limit.</div>
      </div>
      <div class="settings-feature-row">
        <div class="settings-feature-label">Tracked Issues Ticker Loop Duration</div>
        <div class="preferences-input-wrap">
          <input type="number" min="5" max="600" step="1" class="form-control form-control-sm" id="settings-ticker-input" value="${tickerSeconds}">
          <span class="preferences-unit">sec</span>
        </div>
        <div class="preferences-hint">Seconds for one full ticker loop across the screen. Lower = faster. Default 60. Changes take effect on next page load.</div>
      </div>
    `;
    for (const [key, label] of Object.entries(FEATURE_LABELS)) {
      const feat = config[key] || { visibility: 'supervisors', approvedUsers: [] };
      const tiers = featureTiers[key] || FALLBACK_TIERS;
      const optionsHtml = tiers
        .map((t) => `<option value="${t}"${feat.visibility === t ? ' selected' : ''}>${TIER_LABELS[t] || t}</option>`)
        .join('');
      html += `
      <div class="settings-feature-row">
        <div class="settings-feature-label">${label}</div>
        <select class="form-select form-select-sm settings-visibility-select" data-feature="${key}">
          ${optionsHtml}
        </select>
        <div class="settings-approved-users" data-feature="${key}" style="${feat.visibility === 'approvedUsers' ? '' : 'display:none'}">
          ${userList.map(u => `<label class="settings-user-check"><input type="checkbox" value="${u.id}"${feat.approvedUsers.includes(u.id) ? ' checked' : ''}> ${u.name}</label>`).join('')}
        </div>
      </div>`;
    }
    html += `
      <div class="settings-feature-row">
        <div class="settings-feature-label">Slack Channels</div>
        <div class="preferences-hint">Name → Slack channel id (or #name). Used by other services to route notifications.</div>
        <div class="settings-channels-list" id="settings-channels-list">
          ${channels.map((c, i) => channelRowHtml(c, i)).join('')}
        </div>
        <div class="settings-channels-add">
          <input type="text" class="form-control form-control-sm" id="settings-channel-new-name" placeholder="name (e.g. leads)">
          <input type="text" class="form-control form-control-sm" id="settings-channel-new-id" placeholder="channel id (e.g. C046GCASJBH)">
          <button type="button" class="btn btn-outline-primary btn-sm" id="settings-channel-add-btn">Add</button>
        </div>
      </div>`;
    body.innerHTML = html;

    body.querySelectorAll('.settings-visibility-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const feature = sel.dataset.feature;
        config[feature].visibility = sel.value;
        const approvedDiv = body.querySelector(`.settings-approved-users[data-feature="${feature}"]`);
        approvedDiv.style.display = sel.value === 'approvedUsers' ? '' : 'none';
        feedback.textContent = '';
      });
    });

    body.querySelectorAll('.settings-approved-users input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const feature = cb.closest('.settings-approved-users').dataset.feature;
        const checked = [...body.querySelectorAll(`.settings-approved-users[data-feature="${feature}"] input:checked`)].map(c => c.value);
        config[feature].approvedUsers = checked;
        feedback.textContent = '';
      });
    });

    const bufferInput = body.querySelector('#settings-buffer-input');
    bufferInput.addEventListener('input', () => {
      bufferMin = Math.max(0, Math.round(Number(bufferInput.value) || 0));
      feedback.textContent = '';
    });

    bindChannelRowEvents();
    const addBtn = body.querySelector('#settings-channel-add-btn');
    const newName = body.querySelector('#settings-channel-new-name');
    const newId = body.querySelector('#settings-channel-new-id');
    addBtn.addEventListener('click', () => {
      const name = newName.value.trim();
      const id = newId.value.trim();
      if (!name || !id) {
        feedback.textContent = 'Channel name and id are both required.';
        feedback.className = 'settings-feedback text-danger';
        return;
      }
      if (channels.some((c) => c.name.trim() === name)) {
        feedback.textContent = `A channel named "${name}" already exists.`;
        feedback.className = 'settings-feedback text-danger';
        return;
      }
      channels.push({ name, id });
      newName.value = '';
      newId.value = '';
      refreshChannelsList();
      feedback.textContent = '';
    });
  }

  renderSettingsForm();

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    feedback.textContent = '';

    // Build channels payload; reject empty names/ids and duplicates before hitting the server.
    const channelsPayload = {};
    for (const c of channels) {
      const name = c.name.trim();
      const id = c.id.trim();
      if (!name || !id) {
        feedback.textContent = 'Every channel needs a non-empty name and id.';
        feedback.className = 'settings-feedback text-danger';
        saveBtn.disabled = false;
        return;
      }
      if (Object.prototype.hasOwnProperty.call(channelsPayload, name)) {
        feedback.textContent = `Duplicate channel name: ${name}`;
        feedback.className = 'settings-feedback text-danger';
        saveBtn.disabled = false;
        return;
      }
      channelsPayload[name] = id;
    }

    try {
      const tickerInput = document.getElementById('settings-ticker-input');
      const tickerVal = Number(tickerInput && tickerInput.value);
      const [visRes, bufRes, chanRes, tickerRes] = await Promise.all([
        fetch(`${basePath}/api/settings/visibility`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        }),
        fetch(`${basePath}/api/settings/breakLateBuffer`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seconds: minToSec(bufferMin) }),
        }),
        fetch(`${basePath}/api/settings/channels`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channels: channelsPayload }),
        }),
        fetch(`${basePath}/api/settings/trackedIssuesTickerSpeed`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seconds: tickerVal }),
        }),
      ]);
      if (!visRes.ok || !bufRes.ok || !chanRes.ok || !tickerRes.ok) throw new Error('Save failed');
      feedback.textContent = 'Saved! Reload the page to see changes.';
      feedback.className = 'settings-feedback text-success';
    } catch {
      feedback.textContent = 'Failed to save settings.';
      feedback.className = 'settings-feedback text-danger';
    }
    saveBtn.disabled = false;
  };
}

(() => {
  window.addEventListener('rcs:user-loaded', (e) => {
    if (!document.getElementById('settings-modal')) return;
    const user = e.detail || (window.rcs && window.rcs.currentUser) || null;
    if (!user || !user.superAdmin) return;
    initSettingsPanel();
  });
})();
})();
