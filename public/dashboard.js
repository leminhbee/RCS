let dashboardData = { agents: [], queue: [], stats: {}, callLists: {} };
let isSupervisor = false;

// -- Call list column config --
const DEFAULT_COLS = ['callerName', 'callerNumber', 'type', 'companyName', 'agentName', 'duration', 'queueDuration', 'endTime', 'sfCase'];
const callType = (c) => {
  if (c.status === 'ABANDONED') return 'Abandoned';
  if (c.status === 'CALLBACK_FAILED') return 'CB Failed';
  if (c.outbound) return 'Outbound';
  if (c.callbackRequested) return 'Callback';
  return 'Inbound';
};
const CALL_COLUMNS = {
  callerName:    { label: 'Caller',        sortVal: c => c.callerName || '',                          render: c => c.callerName || '--' },
  callerNumber:  { label: 'Phone',         sortVal: c => c.callerNumber || '',                        render: c => (c.callLink && c.callLink.startsWith('http')) ? `<a class="call-recording-link" href="${c.callLink}" target="_blank" rel="noopener">${c.callerNumber || '--'}</a>` : (c.callerNumber || '--') },
  type:          { label: 'Type',          sortVal: c => callType(c),                                 render: c => callType(c) },
  companyName:   { label: 'Company',       sortVal: c => c.companyName || '',                         render: c => c.companyName || '--' },
  agentName:     { label: 'Agent',         sortVal: c => c.agentName || '',                           render: c => c.agentName || '--' },
  duration:      { label: 'Call Duration', sortVal: c => c.duration || 0,                             render: c => formatSeconds(c.duration) },
  queueDuration: { label: 'Queue Wait',    sortVal: c => c.queueDuration || 0,                        render: c => formatSeconds(c.queueDuration) },
  endTime:       { label: 'Ended',         sortVal: c => c.endTime ? new Date(c.endTime).getTime() : 0, render: c => formatTimeAgo(c.endTime) },
  sfCase:        { label: 'SF Case',       sortVal: c => c.salesforceCaseNumber || '',                render: c => c.salesforceCaseId && c.salesforceCaseNumber ? `<a href="https://ipdatatel.lightning.force.com/lightning/r/Case/${c.salesforceCaseId}/view" target="_blank" rel="noopener">${c.salesforceCaseNumber}</a>` : '--' },
};
let colOrder = [...DEFAULT_COLS];
let colHidden = new Set();
let callSearch = '';
let sortKey = null;
let sortDir = 'asc';

function loadColPrefs() {
  try {
    const saved = localStorage.getItem('callListCols');
    if (!saved) return;
    const { order, hidden } = JSON.parse(saved);
    if (Array.isArray(order)) {
      const known = order.filter(k => CALL_COLUMNS[k]);
      const added = DEFAULT_COLS.filter(k => !known.includes(k));
      colOrder = [...known, ...added];
    }
    if (Array.isArray(hidden)) colHidden = new Set(hidden.filter(k => CALL_COLUMNS[k]));
  } catch (e) {}
}

function saveColPrefs() {
  localStorage.setItem('callListCols', JSON.stringify({ order: colOrder, hidden: [...colHidden] }));
}

let dragSrcKey = null;

function renderColPicker() {
  const panel = document.getElementById('col-picker-panel');
  if (!panel) return;
  panel.innerHTML = '';
  for (const key of colOrder) {
    const col = CALL_COLUMNS[key];
    const item = document.createElement('div');
    item.className = 'col-picker-item';
    item.dataset.key = key;
    item.draggable = true;
    item.innerHTML = `
      <span class="col-picker-handle">&#8942;&#8942;</span>
      <label class="col-picker-label">
        <input type="checkbox" ${colHidden.has(key) ? '' : 'checked'}>
        ${col.label}
      </label>`;
    item.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) colHidden.delete(key); else colHidden.add(key);
      saveColPrefs();
      renderCallList();
    });
    item.addEventListener('dragstart', (e) => {
      dragSrcKey = key;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      panel.querySelectorAll('.col-picker-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      panel.querySelectorAll('.col-picker-item').forEach(el => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (dragSrcKey === key) return;
      const srcIdx = colOrder.indexOf(dragSrcKey);
      const dstIdx = colOrder.indexOf(key);
      colOrder.splice(srcIdx, 1);
      colOrder.splice(dstIdx, 0, dragSrcKey);
      saveColPrefs();
      renderColPicker();
      renderCallList();
    });
    panel.appendChild(item);
  }
  const footer = document.createElement('div');
  footer.className = 'col-picker-footer';
  footer.innerHTML = '<button>Reset to defaults</button>';
  footer.querySelector('button').addEventListener('click', () => {
    colOrder = [...DEFAULT_COLS];
    colHidden = new Set();
    saveColPrefs();
    renderColPicker();
    renderCallList();
  });
  panel.appendChild(footer);
}

// Timezone toggle (only relevant if viewer is not in Central)
const localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const isCentral = localTZ === 'America/Chicago';
let showCentral = isCentral; // default to Central if local, otherwise local

function formatLoginTime(dateStr) {
  if (!dateStr) return '--';
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (showCentral) opts.timeZone = 'America/Chicago';
  return new Date(dateStr).toLocaleTimeString('en-US', opts);
}

// Theme toggle
const toggle = document.getElementById('theme-toggle');
const icon = document.getElementById('toggle-icon');
function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  icon.innerHTML = dark ? '&#9790;' : '&#9788;';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}
toggle.addEventListener('click', () => {
  applyTheme(!document.body.classList.contains('dark'));
});
applyTheme(localStorage.getItem('theme') === 'dark');

// Nav panel toggles
const appPanel = document.getElementById('app-panel');
const profilePanel = document.getElementById('profile-panel');

document.getElementById('app-launcher-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  profilePanel.classList.remove('open');
  appPanel.classList.toggle('open');
});

document.getElementById('profile-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  appPanel.classList.remove('open');
  profilePanel.classList.toggle('open');
});

// Keep panels open when clicking inside them
appPanel.addEventListener('click', (e) => e.stopPropagation());
profilePanel.addEventListener('click', (e) => e.stopPropagation());

// Close panels on outside click
document.addEventListener('click', () => {
  appPanel.classList.remove('open');
  profilePanel.classList.remove('open');
});

function formatDuration(since) {
  if (!since) return '--';
  const seconds = Math.floor((Date.now() - new Date(since)) / 1000);
  if (seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function statusClass(status) {
  if (!status) return '';
  return 'status-' + status.toLowerCase().replace(/[\s_]/g, '-');
}

function renderAgents() {
  const container = document.getElementById('agents-table');
  const agents = dashboardData.agents;
  document.getElementById('agent-count').textContent = agents.length;

  if (agents.length === 0) {
    container.innerHTML = '<div class="empty">No agents logged in</div>';
    return;
  }

  const tzToggle = isCentral ? '' : `<span class="tz-toggle" id="tz-toggle" title="Switch timezone">${showCentral ? 'CT' : 'Local'}</span>`;
  let html = `<table class="table table-striped table-hover table-sm mb-0"><thead><tr><th>Name</th><th>Status</th><th>Duration</th><th>Login ${tzToggle}</th><th class="text-center">Calls Answered</th><th class="text-center">Outbound</th><th>Caller Number</th><th>Caller Name</th><th>Company</th><th>Call Duration</th></tr></thead><tbody>`;
  for (const agent of agents) {
    const sup = agent.supervisor ? '<span class="supervisor-tag">SUP</span>' : '';
    let stClass = statusClass(agent.status);
    if (agent.status === 'ENGAGED' || agent.status === 'OUTBOUND') {
      const secs = Math.floor((Date.now() - new Date(agent.statusSince)) / 1000);
      if (secs >= 1800) stClass = 'status-on-call-long';
    }
    html += `<tr>
      <td>${agent.name}${sup}</td>
      <td><span class="status ${stClass}">${agent.status || '--'}</span></td>
      <td class="duration">${formatDuration(agent.statusSince)}</td>
      <td>${formatLoginTime(agent.lastLogin)}</td>
      <td class="text-center">${agent.callsAnswered || 0}</td>
      <td class="text-center">${agent.outboundCalls || 0}</td>
      <td>${agent.activeCall ? agent.activeCall.callerNumber : ''}</td>
      <td>${agent.activeCall?.callerName || ''}</td>
      <td>${agent.activeCall?.companyName || ''}</td>
      <td class="duration">${agent.activeCall ? formatDuration(agent.activeCall.startTime) : ''}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  const tzBtn = document.getElementById('tz-toggle');
  if (tzBtn) {
    tzBtn.addEventListener('click', () => {
      showCentral = !showCentral;
      renderAgents();
    });
  }
}

function renderQueue() {
  const container = document.getElementById('queue-table');
  const queue = dashboardData.queue;
  document.getElementById('queue-count').textContent = queue.length;

  if (queue.length === 0) {
    container.innerHTML = '<div class="empty">No callers in queue</div>';
    return;
  }

  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr><th>#</th><th>Caller Number</th><th>Caller Name</th><th>Company</th><th>Wait Time</th><th>Status</th><th></th></tr></thead><tbody>';
  for (let i = 0; i < queue.length; i++) {
    const call = queue[i];
    const tag = call.ringing ? '<span class="status status-ringing">Ringing</span>'
      : call.callbackRequested ? '<span class="callback-tag">Callback</span>' : '';
    html += `<tr>
      <td>${i + 1}</td>
      <td>${call.callerNumber || '--'}</td>
      <td>${call.callerName || '--'}</td>
      <td>${call.companyName || '--'}</td>
      <td class="duration">${formatDuration(call.startTime)}</td>
      <td>${tag}</td>
      <td><button class="queue-remove-btn" data-id="${call.id}" title="Remove from queue">&times;</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('.queue-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this call from the queue?')) return;
      btn.disabled = true;
      try {
        const basePath = location.pathname.replace(/\/$/, '');
        await fetch(`${basePath}/api/queue/${btn.dataset.id}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Failed to remove call:', e);
      }
    });
  });
}

function formatSeconds(sec) {
  if (sec == null || sec === 0) return '--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimeAgo(time) {
  if (!time) return '--';
  const mins = Math.floor((Date.now() - new Date(time)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

function renderLive() {
  const queue = dashboardData.queue || [];
  const waitEl = document.getElementById('live-wait-value');
  if (queue.length > 0) {
    const oldest = queue[0];
    const waitSec = Math.floor((Date.now() - new Date(oldest.startTime)) / 1000);
    waitEl.textContent = formatDuration(oldest.startTime);
    waitEl.style.color = waitSec < 60 ? '#16a34a' : waitSec < 300 ? '#ca8a04' : '#dc2626';
    document.getElementById('live-wait-detail').textContent = oldest.callerName || oldest.callerNumber || '--';
  } else {
    waitEl.textContent = '--';
    waitEl.style.color = '';
    document.getElementById('live-wait-detail').textContent = '--';
  }

  const agents = dashboardData.agents || [];
  let longestAgent = null;
  let longestStart = null;
  for (const agent of agents) {
    if (agent.activeCall) {
      const t = new Date(agent.activeCall.startTime);
      if (!longestStart || t < longestStart) {
        longestStart = t;
        longestAgent = agent;
      }
    }
  }
  if (longestAgent) {
    document.getElementById('live-active-value').textContent = formatDuration(longestAgent.activeCall.startTime);
    document.getElementById('live-active-detail').textContent = longestAgent.name;
  } else {
    document.getElementById('live-active-value').textContent = '--';
    document.getElementById('live-active-detail').textContent = '--';
  }
}

function renderStats() {
  if (!isSupervisor) return;
  const s = dashboardData.stats || {};
  const grid = document.getElementById('stats-grid');
  const cards = [
    { value: s.totalCalls || 0, label: 'Total Calls', cls: '' },
    { value: s.totalAnswered || 0, label: 'Answered', cls: 'stat-answered' },
    { value: s.totalOutbound || 0, label: 'Outbound', cls: 'stat-outbound' },
    { value: s.totalAbandoned || 0, label: 'Abandoned', cls: 'stat-abandoned' },
    { value: s.totalCallbackFailed || 0, label: 'CB Failed', cls: 'stat-cb-failed' },
    { value: s.totalCallbacks || 0, label: 'Callbacks', cls: 'stat-callback' },
    { value: formatSeconds(s.avgQueueTime), label: 'Avg Queue', cls: '' },
    { value: formatSeconds(s.longestQueueTime), label: 'Longest Queue', cls: '' },
    { value: formatSeconds(s.avgCallDuration), label: 'Avg Call', cls: '' },
    { value: formatSeconds(s.longestCallDuration), label: 'Longest Call', cls: '' },
  ];
  grid.innerHTML = cards.map(c => `
    <div class="col"><div class="card stat-card ${c.cls} p-2">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div></div>
  `).join('');
}

function renderCallList() {
  if (!isSupervisor) return;
  const container = document.getElementById('recent-calls-table');
  const selected = document.getElementById('call-list-select').value;
  const calls = (dashboardData.callLists || {})[selected] || [];

  if (calls.length === 0) {
    container.innerHTML = '<div class="empty">No calls to display</div>';
    return;
  }

  const q = callSearch.toLowerCase().trim();
  const filtered = q ? calls.filter(c => [
    c.callerName, c.callerNumber, c.companyName, c.agentName, c.salesforceCaseNumber,
  ].some(v => v && v.toLowerCase().includes(q))) : calls;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">No calls match your search</div>';
    return;
  }

  let sorted = filtered;
  if (sortKey && CALL_COLUMNS[sortKey]) {
    const sv = CALL_COLUMNS[sortKey].sortVal;
    sorted = [...filtered].sort((a, b) => {
      const av = sv(a), bv = sv(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const visibleCols = colOrder.filter(k => !colHidden.has(k));
  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr>';
  for (const key of visibleCols) {
    const active = sortKey === key;
    const indicator = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    html += `<th class="sort-th${active ? ' sort-active' : ''}" data-sort-key="${key}">${CALL_COLUMNS[key].label}${indicator}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const call of sorted) {
    html += '<tr>';
    for (const key of visibleCols) html += `<td>${CALL_COLUMNS[key].render(call)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort-key]');
    if (!th) return;
    const key = th.dataset.sortKey;
    if (sortKey === key) {
      if (sortDir === 'asc') {
        sortDir = 'desc';
      } else {
        sortKey = null;
        sortDir = 'asc';
      }
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    renderCallList();
  });
}

function render() {
  renderAgents();
  renderQueue();
  renderLive();
  renderStats();
  renderCallList();
}

// -- Supervisor init: inject stats section and connect WS --
async function init() {
  const basePath = location.pathname.replace(/\/$/, '');
  try {
    const res = await fetch(`${basePath}/api/me`);
    const user = await res.json();

    // Populate MS nav profile
    if (user?.name) {
      const initials = user.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
      document.getElementById('ms-avatar').textContent = initials;
      document.getElementById('ms-avatar-lg').textContent = initials;
      document.getElementById('ms-profile-name').textContent = user.name;
    }
    if (user?.email) {
      document.getElementById('ms-profile-email').textContent = user.email;
    }
    if (user?.supervisor) {
      document.getElementById('ms-profile-badge').style.display = 'inline-block';
    }

    if (user?.supervisor) {
      isSupervisor = true;
      document.getElementById('stats-container').innerHTML = `
        <div class="card mb-3">
          <div class="card-header"><strong>Today's Stats</strong></div>
          <div class="card-body">
            <div class="row g-2 mb-3" id="stats-grid"></div>
            <div class="d-flex align-items-center gap-2 mb-2">
              <select class="call-list-select" id="call-list-select">
                <option value="allCalls">All Calls</option>
                <option value="recentCalls">Recent Calls</option>
                <option value="longestCalls">Longest Calls</option>
                <option value="longestQueue">Longest Queue</option>
                <option value="abandonedCalls">Abandoned Calls</option>
              </select>
              <input type="search" id="call-search" class="call-list-search" placeholder="Search…" autocomplete="off">
              <div class="col-picker-wrap ms-auto">
                <button class="col-picker-btn" id="col-picker-btn">&#9881; Columns</button>
                <div class="col-picker-panel" id="col-picker-panel"></div>
              </div>
            </div>
            <div id="recent-calls-table"></div>
          </div>
        </div>`;
      document.getElementById('call-list-select').addEventListener('change', renderCallList);
      document.getElementById('call-search').addEventListener('input', (e) => {
        callSearch = e.target.value;
        renderCallList();
      });
      const pickerBtn = document.getElementById('col-picker-btn');
      const pickerPanel = document.getElementById('col-picker-panel');
      pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerPanel.classList.toggle('open');
      });
      document.addEventListener('click', () => pickerPanel.classList.remove('open'));
      pickerPanel.addEventListener('click', (e) => e.stopPropagation());
      renderColPicker();
    }
  } catch (e) {
    console.error('Failed to fetch user session:', e);
  }
  connectWebSocket();
}

// -- WebSocket connection with auto-reconnect --
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = location.pathname.replace(/\/$/, '');
  const wsUrl = `${protocol}//${location.host}${basePath}/ws`;

  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.addEventListener('message', (event) => {
    try {
      dashboardData = JSON.parse(event.data);
      render();
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  });

  ws.addEventListener('close', () => {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 3000);
    }
  });

  ws.addEventListener('error', () => {
    ws.close();
  });
}

// Update ticking timers every 1 second
setInterval(render, 1000);
// Load saved column preferences, then init
loadColPrefs();
init();
