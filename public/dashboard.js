let dashboardData = { agents: [], queue: [], stats: {}, callLists: {} };
let permissions = {};
let isSuperAdmin = false;
let isSupervisor = false;
let selectedDate = null; // null = today (live mode)

function isToday(dateStr) {
  if (!dateStr) return true;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

async function fetchStatsForDate(dateStr) {
  const basePath = location.pathname.replace(/\/$/, '');
  const res = await fetch(`${basePath}/api/stats?date=${dateStr}`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

// -- Call list column config --
const DEFAULT_COLS = ['startTime', 'callerName', 'callerNumber', 'type', 'companyName', 'agentName', 'duration', 'queueDuration', 'endTime', 'sfCase', 'caseSubject'];
const callType = (c) => {
  if (c.status === 'ABANDONED') return 'Abandoned';
  if (c.status === 'CALLBACK_FAILED') return 'CB Failed';
  if (c.outbound) return 'Outbound';
  if (c.callbackRequested) return 'Callback';
  return 'Inbound';
};
function formatDateTime(time) {
  if (!time) return '--';
  return new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const CALL_COLUMNS = {
  startTime:     { label: 'Date/Time',     sortVal: c => c.startTime ? new Date(c.startTime).getTime() : 0, render: c => formatDateTime(c.startTime) },
  callerName:    { label: 'Caller',        sortVal: c => c.callerName || '',                          render: c => c.callerName || '--' },
  callerNumber:  { label: 'Phone',         sortVal: c => c.callerNumber || '',                        render: c => (c.callLink && c.callLink.startsWith('http')) ? `<a class="call-recording-link" href="${c.callLink}" target="_blank" rel="noopener">${c.callerNumber || '--'}</a>` : (c.callerNumber || '--') },
  type:          { label: 'Type',          sortVal: c => callType(c),                                 render: c => callType(c) },
  companyName:   { label: 'Company',       sortVal: c => c.companyName || '',                         render: c => c.companyName || '--' },
  agentName:     { label: 'Agent',         sortVal: c => c.agentName || '',                           render: c => c.agentName || '--' },
  duration:      { label: 'Call Duration', sortVal: c => c.duration || 0,                             render: c => formatSeconds(c.duration) },
  queueDuration: { label: 'Queue Wait',    sortVal: c => c.queueDuration || 0,                        render: c => formatSeconds(c.queueDuration) },
  endTime:       { label: 'Ended',         sortVal: c => c.endTime ? new Date(c.endTime).getTime() : 0, render: c => `<span class="js-end-time-ago" data-end="${c.endTime || ''}">${formatTimeAgo(c.endTime)}</span>` },
  sfCase:        { label: 'SF Case',       sortVal: c => c.salesforceCaseNumber || '',                render: c => c.salesforceCaseId && c.salesforceCaseNumber ? `<a href="https://ipdatatel.lightning.force.com/lightning/r/Case/${c.salesforceCaseId}/view" target="_blank" rel="noopener">${c.salesforceCaseNumber}</a>` : '--' },
  caseSubject:   { label: 'Subject',       sortVal: c => c.caseSubject || '',                         render: c => c.caseSubject || '--' },
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
  const metricsHeaders = permissions.agentMetrics ? `<th>Login ${tzToggle}</th><th class="text-center">Calls Answered</th><th class="text-center">Outbound</th>` : '';
  const timesCalledHeader = permissions.callCountByNumber ? '<th class="text-center">Times Called</th>' : '';
  let html = `<table class="table table-striped table-hover table-sm mb-0"><thead><tr><th>Name</th><th>Status</th><th>Duration</th>${metricsHeaders}${timesCalledHeader}<th>Caller Number</th><th>Caller Name</th><th>Company</th><th>Call Duration</th></tr></thead><tbody>`;
  for (const agent of agents) {
    const sup = agent.supervisor ? '<span class="supervisor-tag">SUP</span>' : '';
    let stClass = statusClass(agent.status);
    if (agent.status === 'ENGAGED' || agent.status === 'OUTBOUND') {
      const secs = Math.floor((Date.now() - new Date(agent.statusSince)) / 1000);
      if (secs >= 1800) stClass = 'status-on-call-long';
    }
    const metricsCells = permissions.agentMetrics ? `<td>${formatLoginTime(agent.lastLogin)}</td><td class="text-center">${agent.callsAnswered || 0}</td><td class="text-center">${agent.outboundCalls || 0}</td>` : '';
    const timesCalledCell = permissions.callCountByNumber ? `<td class="text-center">${agent.activeCall ? (() => { const counts = dashboardData.liveCallCountByNumber || dashboardData.callCountByNumber; const cnt = counts?.[agent.activeCall.callerNumber] || 0; return cnt > 1 ? `<span class="repeat-caller-badge">${cnt}</span>` : (cnt || ''); })() : ''}</td>` : '';
    const canClearCalls = isSupervisor || isSuperAdmin;
    const callDurationCell = agent.activeCall
      ? `${formatDuration(agent.activeCall.startTime)}${
          agent.activeCall.status === 'ACTIVE' && canClearCalls
            ? ` <button class="agent-call-clear-btn" data-id="${agent.activeCall.id}" title="Clear stuck call">&times;</button>`
            : ''
        }`
      : '';
    html += `<tr data-agent-id="${agent.id}">
      <td>${agent.name}${sup}</td>
      <td><span class="status js-status ${stClass}" data-since="${agent.statusSince}">${agent.status || '--'}</span></td>
      <td class="duration js-duration-status">${formatDuration(agent.statusSince)}</td>
      ${metricsCells}${timesCalledCell}
      <td>${agent.activeCall ? agent.activeCall.callerNumber : ''}</td>
      <td>${agent.activeCall?.callerName || ''}</td>
      <td>${agent.activeCall?.companyName || ''}</td>
      <td class="duration js-duration-call" data-start="${agent.activeCall?.startTime || ''}">${callDurationCell}</td>
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

  container.querySelectorAll('.agent-call-clear-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Clear this stuck call from the agent? It will be marked COMPLETE.')) return;
      btn.disabled = true;
      try {
        const basePath = location.pathname.replace(/\/$/, '');
        await fetch(`${basePath}/api/call/${btn.dataset.id}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Failed to clear call:', e);
      }
    });
  });
}

function renderAgentsTick() {
  const agents = dashboardData.agents;
  document.getElementById('agent-count').textContent = agents.length;
  const byId = new Map(agents.map(a => [a.id, a]));
  document.querySelectorAll('#agents-table tbody tr[data-agent-id]').forEach((row) => {
    const agent = byId.get(row.dataset.agentId);
    if (!agent) return;

    const statusCell = row.querySelector('.js-duration-status');
    if (statusCell) statusCell.textContent = formatDuration(agent.statusSince);

    const callCell = row.querySelector('.js-duration-call');
    if (callCell && agent.activeCall) {
      // Rewrite only the leading text node so the clear button (if present) survives.
      const text = formatDuration(agent.activeCall.startTime);
      const firstText = [...callCell.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
      if (firstText) firstText.nodeValue = callCell.querySelector('button') ? text + ' ' : text;
      else callCell.prepend(document.createTextNode(text));
    }

    const statusEl = row.querySelector('.js-status');
    if (statusEl && (agent.status === 'ENGAGED' || agent.status === 'OUTBOUND')) {
      const secs = Math.floor((Date.now() - new Date(agent.statusSince)) / 1000);
      statusEl.classList.toggle('status-on-call-long', secs >= 1800);
    }
  });
}

function renderQueue() {
  const container = document.getElementById('queue-table');
  const queue = dashboardData.queue;
  document.getElementById('queue-count').textContent = queue.length;

  if (queue.length === 0) {
    container.innerHTML = '<div class="empty">No callers in queue</div>';
    return;
  }

  const canClearCalls = isSupervisor || isSuperAdmin;
  const queueTimesCalledHeader = permissions.callCountByNumber ? '<th class="text-center">Times Called</th>' : '';
  const removeHeader = canClearCalls ? '<th></th>' : '';
  let html = `<table class="table table-striped table-hover table-sm mb-0"><thead><tr><th>#</th><th>Caller Number</th><th>Caller Name</th><th>Company</th><th>Wait Time</th>${queueTimesCalledHeader}<th>Status</th>${removeHeader}</tr></thead><tbody>`;
  for (let i = 0; i < queue.length; i++) {
    const call = queue[i];
    const tag = call.ringing ? '<span class="status status-ringing">Ringing</span>'
      : call.callbackRequested ? '<span class="callback-tag">Callback</span>' : '';
    const queueTimesCalledCell = permissions.callCountByNumber ? (() => {
      const counts = dashboardData.liveCallCountByNumber || dashboardData.callCountByNumber;
      const cnt = counts?.[call.callerNumber] || 0;
      return `<td class="text-center">${cnt > 1 ? `<span class="repeat-caller-badge">${cnt}</span>` : (cnt || '--')}</td>`;
    })() : '';
    const removeCell = canClearCalls
      ? `<td><button class="queue-remove-btn" data-id="${call.id}" title="Remove from queue">&times;</button></td>`
      : '';
    html += `<tr data-call-id="${call.id}">
      <td>${i + 1}</td>
      <td>${call.callerNumber || '--'}</td>
      <td>${call.callerName || '--'}</td>
      <td>${call.companyName || '--'}</td>
      <td class="duration js-duration-wait" data-start="${call.startTime}">${formatDuration(call.startTime)}</td>
      ${queueTimesCalledCell}
      <td>${tag}</td>
      ${removeCell}
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('.queue-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById('confirm-remove-modal');
      const confirmBtn = document.getElementById('confirm-remove-btn');
      const bsModal = bootstrap.Modal.getOrCreateInstance(modal);
      // Replace handler each time to bind the correct call ID
      const handler = async () => {
        confirmBtn.removeEventListener('click', handler);
        bsModal.hide();
        btn.disabled = true;
        try {
          const basePath = location.pathname.replace(/\/$/, '');
          await fetch(`${basePath}/api/queue/${btn.dataset.id}`, { method: 'DELETE' });
        } catch (e) {
          console.error('Failed to remove call:', e);
        }
      };
      confirmBtn.addEventListener('click', handler);
      modal.addEventListener('hidden.bs.modal', () => {
        confirmBtn.removeEventListener('click', handler);
      }, { once: true });
      bsModal.show();
    });
  });
}

function renderQueueTick() {
  const queue = dashboardData.queue;
  document.getElementById('queue-count').textContent = queue.length;
  const byId = new Map(queue.map(c => [c.id, c]));
  document.querySelectorAll('#queue-table tbody tr[data-call-id]').forEach((row) => {
    const call = byId.get(row.dataset.callId);
    if (!call) return;
    const cell = row.querySelector('.js-duration-wait');
    if (cell) cell.textContent = formatDuration(call.startTime);
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
  if (!permissions.stats) return;
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
  if (!permissions.callLists) return;
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

function renderCallListTick() {
  document.querySelectorAll('#recent-calls-table .js-end-time-ago[data-end]').forEach((el) => {
    el.textContent = formatTimeAgo(el.dataset.end);
  });
}

function renderRepeatCallers() {
  if (!permissions.repeatCallers) return;
  const container = document.getElementById('repeat-callers-table');
  if (!container) return;

  const rc = dashboardData.repeatCallers || [];
  const countEl = document.getElementById('repeat-callers-count');
  if (countEl) countEl.textContent = rc.length;

  if (rc.length === 0) {
    container.innerHTML = '<div class="empty">No repeat callers today</div>';
    return;
  }

  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr><th>Caller Number</th><th>Caller Name</th><th>Company</th><th class="text-center">Times Called</th><th></th></tr></thead><tbody>';
  for (const caller of rc) {
    html += `<tr>
      <td>${caller.callerNumber}</td>
      <td>${caller.callerName || '--'}</td>
      <td>${caller.companyName || '--'}</td>
      <td class="text-center"><span class="repeat-caller-badge">${caller.count}</span></td>
      <td><button class="btn btn-sm btn-outline-primary repeat-caller-detail-btn" data-number="${caller.callerNumber}">View Calls</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('.repeat-caller-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const number = btn.dataset.number;
      const match = rc.find(r => r.callerNumber === number);
      if (match) showRepeatCallerModal(match);
    });
  });
}

function showRepeatCallerModal(repeatCaller) {
  const modal = document.getElementById('repeat-caller-modal');
  const title = document.getElementById('repeat-caller-modal-title');
  const body = document.getElementById('repeat-caller-modal-body');

  title.textContent = `Calls from ${repeatCaller.callerNumber} (${repeatCaller.companyName || '--'})`;

  const visibleCols = colOrder.filter(k => !colHidden.has(k));
  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr>';
  for (const key of visibleCols) {
    html += `<th>${CALL_COLUMNS[key].label}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const call of repeatCaller.calls) {
    html += '<tr>';
    for (const key of visibleCols) html += `<td>${CALL_COLUMNS[key].render(call)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  body.innerHTML = html;
  bootstrap.Modal.getOrCreateInstance(modal).show();
}

function render() {
  renderAgents();
  renderQueue();
  renderLive();
  renderStats();
  renderCallList();
  renderRepeatCallers();
}

// -- Init: inject sections based on permissions and connect WS --
async function init() {
  const basePath = location.pathname.replace(/\/$/, '');
  try {
    const res = await fetch(`${basePath}/api/me`);
    const user = await res.json();
    permissions = user?.permissions || {};
    isSuperAdmin = !!user?.superAdmin;
    isSupervisor = !!user?.supervisor;

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
      document.getElementById('live-active-card').style.display = '';
    }
    if (user?.ssoEnabled) {
      document.getElementById('change-password-link').style.display = 'none';
      document.getElementById('change-password-divider').style.display = 'none';
    }

    // Self-service preferences (any user)
    initPreferencesPanel();

    // Announcement banner (all users) + compose entrypoint (supervisors)
    initAnnouncements();
    if (isSupervisor || isSuperAdmin) {
      document.getElementById('announcement-menu').style.display = '';
    }

    // SuperAdmin settings menu item
    if (isSuperAdmin) {
      document.getElementById('settings-menu').style.display = '';
      initSettingsPanel();
    }
    // Per-user feature flags (supervisors + superAdmins)
    if (isSupervisor || isSuperAdmin) {
      document.getElementById('user-flags-menu').style.display = '';
      initUserFlagsPanel();
    }
    // Show the divider above the admin section if either admin item is visible
    if (isSuperAdmin || isSupervisor) {
      document.getElementById('admin-menu-divider').style.display = '';
    }
    // Reports link is gated by the configured visibility tier (supervisors / approvedUsers / selfOnly).
    if (permissions.reports) {
      document.getElementById('reports-nav-link').style.display = '';
    }

    // Build stats container based on permissions
    const hasAnyStatsSection = permissions.repeatCallers || permissions.stats || permissions.callLists;
    if (hasAnyStatsSection) {
      let statsHTML = '';

      if (permissions.repeatCallers) {
        statsHTML += `
        <div class="card mb-3">
          <div class="card-header d-flex align-items-center gap-2" style="cursor:pointer" data-bs-toggle="collapse" data-bs-target="#repeat-callers-collapse" aria-expanded="true" aria-controls="repeat-callers-collapse">
            <span class="collapse-chevron" id="repeat-callers-chevron">&#9660;</span>
            <strong>Repeat Callers</strong> <span class="count" id="repeat-callers-count">0</span>
          </div>
          <div class="collapse show" id="repeat-callers-collapse">
            <div class="card-body p-0" id="repeat-callers-table"></div>
          </div>
        </div>`;
      }

      if (permissions.stats || permissions.callLists) {
        statsHTML += `
        <div class="card mb-3">
          <div class="card-header d-flex align-items-center gap-2">
            <strong id="stats-title">Today's Stats</strong>
            <input type="date" id="stats-date-picker" class="form-control form-control-sm ms-auto" style="width:auto" title="Select a date">
          </div>
          <div class="card-body">
            ${permissions.stats ? '<div class="row g-2 mb-3" id="stats-grid"></div>' : ''}
            ${permissions.callLists ? `
            <div class="d-flex align-items-center gap-2 mb-2">
              <select class="call-list-select" id="call-list-select">
                <option value="allCalls">All Calls</option>
                <option value="recentCalls">Recent Calls</option>
                <option value="longestCalls">Longest Calls</option>
                <option value="longestQueue">Longest Queue</option>
                <option value="abandonedCalls">Abandoned Calls</option>
              </select>
              <input type="search" id="call-search" class="form-control form-control-sm" style="min-width:180px;max-width:250px" placeholder="Search…" autocomplete="off">
              <div class="dropdown ms-auto">
                <button class="col-picker-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false" id="col-picker-btn">&#9881; Columns</button>
                <div class="dropdown-menu dropdown-menu-end col-picker-panel" id="col-picker-panel"></div>
              </div>
            </div>
            <div id="recent-calls-table"></div>` : ''}
          </div>
        </div>`;
      }

      document.getElementById('stats-container').innerHTML = statsHTML;

      if (permissions.callLists) {
        document.getElementById('call-list-select').addEventListener('change', renderCallList);
        document.getElementById('call-search').addEventListener('input', (e) => {
          callSearch = e.target.value;
          renderCallList();
        });
        renderColPicker();
      }

      if (permissions.repeatCallers) {
        const rcCollapse = document.getElementById('repeat-callers-collapse');
        const rcChevron = document.getElementById('repeat-callers-chevron');
        rcCollapse.addEventListener('show.bs.collapse', () => { rcChevron.textContent = '\u25BC'; });
        rcCollapse.addEventListener('hide.bs.collapse', () => { rcChevron.textContent = '\u25B6'; });
      }

      if (permissions.stats || permissions.callLists) {
        const datePicker = document.getElementById('stats-date-picker');
        const todayStr = new Date().toISOString().split('T')[0];
        datePicker.value = todayStr;
        datePicker.max = todayStr;
        datePicker.addEventListener('change', async (e) => {
          const picked = e.target.value;
          if (!picked) return;
          if (isToday(picked)) {
            selectedDate = null;
            document.getElementById('stats-title').textContent = "Today's Stats";
            try {
              const data = await fetchStatsForDate(picked);
              dashboardData.stats = data.stats;
              dashboardData.callLists = data.callLists;
              dashboardData.callCountByNumber = data.callCountByNumber;
              dashboardData.repeatCallers = data.repeatCallers;
            } catch (err) {
              console.error('Failed to fetch today stats:', err);
            }
            renderStats();
            renderCallList();
            renderRepeatCallers();
          } else {
            selectedDate = picked;
            const d = new Date(picked + 'T00:00:00');
            const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            document.getElementById('stats-title').textContent = `Stats for ${formatted}`;
            try {
              const data = await fetchStatsForDate(picked);
              dashboardData.stats = data.stats;
              dashboardData.callLists = data.callLists;
              dashboardData.callCountByNumber = data.callCountByNumber;
              dashboardData.repeatCallers = data.repeatCallers;
              renderStats();
              renderCallList();
              renderRepeatCallers();
            } catch (err) {
              console.error('Failed to fetch stats for date:', err);
            }
          }
        });
      }
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
      const incoming = JSON.parse(event.data);
      if (selectedDate) {
        // Viewing a past date: update live sections only, preserve historical stats/callLists/repeatCallers
        dashboardData.agents = incoming.agents;
        dashboardData.queue = incoming.queue;
        // Keep live callCountByNumber for agent/queue "Times Called" column
        if (incoming.callCountByNumber) dashboardData.liveCallCountByNumber = incoming.callCountByNumber;
        renderAgents();
        renderQueue();
        renderLive();
      } else {
        dashboardData = incoming;
        render();
      }
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

// -- SuperAdmin Settings Panel --
const FEATURE_LABELS = {
  stats: 'Stats Grid',
  callLists: 'Call Lists',
  repeatCallers: 'Repeat Callers',
  agentMetrics: 'Agent Metrics (Login, Calls, Outbound)',
  callCountByNumber: 'Times Called Column',
  reports: 'Reports',
};

const TIER_LABELS = {
  all: 'All Users',
  supervisors: 'Supervisors Only',
  approvedUsers: 'Approved Users',
  selfOnly: 'All Users (own data only)',
};

const FALLBACK_TIERS = ['all', 'supervisors', 'approvedUsers'];

async function initSettingsPanel() {
  const basePath = location.pathname.replace(/\/$/, '');
  const body = document.getElementById('settings-modal-body');
  const saveBtn = document.getElementById('settings-save-btn');
  const feedback = document.getElementById('settings-feedback');

  let config = {};
  let userList = [];
  let featureTiers = {};
  let bufferMin = 2;
  // Channels stored as an array to preserve display order and allow duplicate-name detection while editing.
  let channels = [];

  try {
    const [visRes, bufRes, chanRes] = await Promise.all([
      fetch(`${basePath}/api/settings/visibility`),
      fetch(`${basePath}/api/settings/breakLateBuffer`),
      fetch(`${basePath}/api/settings/channels`),
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
      const [visRes, bufRes, chanRes] = await Promise.all([
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
      ]);
      if (!visRes.ok || !bufRes.ok || !chanRes.ok) throw new Error('Save failed');
      feedback.textContent = 'Saved! Reload the page to see changes.';
      feedback.className = 'settings-feedback text-success';
    } catch {
      feedback.textContent = 'Failed to save settings.';
      feedback.className = 'settings-feedback text-danger';
    }
    saveBtn.disabled = false;
  };
}

// Convert between seconds (API storage unit) and integer minutes (UI unit).
// 89 sec → 1 min, 120 sec → 2 min. Rounds to nearest minute.
const secToMin = (s) => Math.max(0, Math.round((Number(s) || 0) / 60));
const minToSec = (m) => Math.max(0, Math.round(Number(m) || 0) * 60);

async function initPreferencesPanel() {
  const basePath = location.pathname.replace(/\/$/, '');
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

async function initUserFlagsPanel() {
  const basePath = location.pathname.replace(/\/$/, '');
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

// -- Announcements --
let currentAnnouncements = [];

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchAnnouncements() {
  const basePath = location.pathname.replace(/\/$/, '');
  try {
    const res = await fetch(`${basePath}/api/announcements`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    currentAnnouncements = data.announcements || [];
  } catch {
    currentAnnouncements = [];
  }
  renderAnnouncementBanner();
  maybeShowAckModal();
}

function renderAnnouncementBanner() {
  const banner = document.getElementById('announcement-banner');
  if (!banner) return;
  if (currentAnnouncements.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  const canManage = isSupervisor || isSuperAdmin;
  banner.style.display = '';
  banner.innerHTML = currentAnnouncements.map((a) => {
    const created = a.createdAt ? new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const actions = canManage
      ? `<button class="btn btn-sm btn-outline-secondary announcement-acks-btn" data-id="${a.id}">Ack status</button>
         <button class="btn btn-sm btn-outline-danger announcement-clear-btn" data-id="${a.id}">Clear</button>`
      : (a.acknowledgedByMe
          ? `<span class="announcement-ack-pill">Acknowledged</span>`
          : `<button class="btn btn-sm btn-warning announcement-ack-btn" data-id="${a.id}">Acknowledge</button>`);
    return `<div class="announcement-item">
      <div class="announcement-text">
        <div class="announcement-title">${escapeHtml(a.title)}</div>
        <div class="announcement-body">${escapeHtml(a.body)}</div>
        <div class="announcement-meta">${created}</div>
      </div>
      <div class="announcement-actions">${actions}</div>
    </div>`;
  }).join('');

  banner.querySelectorAll('.announcement-ack-btn').forEach((btn) => {
    btn.addEventListener('click', () => ackAnnouncement(btn.dataset.id, btn));
  });
  banner.querySelectorAll('.announcement-clear-btn').forEach((btn) => {
    btn.addEventListener('click', () => clearAnnouncement(btn.dataset.id, btn));
  });
  banner.querySelectorAll('.announcement-acks-btn').forEach((btn) => {
    btn.addEventListener('click', () => showAckStatus(btn.dataset.id));
  });
}

function maybeShowAckModal() {
  if (isSupervisor || isSuperAdmin) return;
  const unacked = currentAnnouncements.filter((a) => !a.acknowledgedByMe);
  const modalEl = document.getElementById('announcement-ack-modal');
  const bodyEl = document.getElementById('announcement-ack-modal-body');
  const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  if (unacked.length === 0) {
    bsModal.hide();
    return;
  }
  bodyEl.innerHTML = unacked.map((a) => `
    <div class="announcement-item mb-2 pb-2 border-bottom">
      <div class="announcement-text">
        <div class="announcement-title">${escapeHtml(a.title)}</div>
        <div class="announcement-body">${escapeHtml(a.body)}</div>
      </div>
      <div class="announcement-actions mt-2">
        <button class="btn btn-sm btn-warning announcement-ack-btn" data-id="${a.id}">Acknowledge</button>
      </div>
    </div>`).join('');
  bodyEl.querySelectorAll('.announcement-ack-btn').forEach((btn) => {
    btn.addEventListener('click', () => ackAnnouncement(btn.dataset.id, btn));
  });
  bsModal.show();
}

async function ackAnnouncement(id, btn) {
  const basePath = location.pathname.replace(/\/$/, '');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${basePath}/api/announcements/${id}/ack`, { method: 'POST' });
    if (!res.ok) throw new Error('ack failed');
    await fetchAnnouncements();
  } catch {
    if (btn) btn.disabled = false;
  }
}

async function clearAnnouncement(id, btn) {
  if (!confirm('Clear this announcement? Acknowledgement history will be preserved.')) return;
  const basePath = location.pathname.replace(/\/$/, '');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${basePath}/api/announcements/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('clear failed');
    await fetchAnnouncements();
  } catch {
    if (btn) btn.disabled = false;
  }
}

async function showAckStatus(id) {
  const basePath = location.pathname.replace(/\/$/, '');
  const modalEl = document.getElementById('announcement-acks-modal');
  const bodyEl = document.getElementById('announcement-acks-modal-body');
  const titleEl = document.getElementById('announcement-acks-modal-title');
  const ann = currentAnnouncements.find((a) => a.id === id);
  titleEl.textContent = ann ? `Ack Status — ${ann.title}` : 'Ack Status';
  bodyEl.innerHTML = 'Loading…';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  try {
    const res = await fetch(`${basePath}/api/announcements/${id}/acks`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const ackedList = (data.acknowledged || []).map((u) => `<li>${escapeHtml(u.name)} <span class="text-muted small">${new Date(u.ackedAt).toLocaleString()}</span></li>`).join('');
    const pendingList = (data.pending || []).map((u) => `<li>${escapeHtml(u.name)}</li>`).join('');
    bodyEl.innerHTML = `
      <div class="row">
        <div class="col-md-6">
          <h6>Pending (${data.pending?.length || 0})</h6>
          <ul class="small">${pendingList || '<li class="text-muted">None</li>'}</ul>
        </div>
        <div class="col-md-6">
          <h6>Acknowledged (${data.acknowledged?.length || 0})</h6>
          <ul class="small">${ackedList || '<li class="text-muted">None</li>'}</ul>
        </div>
      </div>`;
  } catch {
    bodyEl.innerHTML = '<p class="text-danger">Failed to load ack status.</p>';
  }
}

function initAnnouncements() {
  // Expose role flags for shared announcement helpers.
  window.isSupervisor = isSupervisor;
  window.isSuperAdmin = isSuperAdmin;
  fetchAnnouncements();
  setInterval(fetchAnnouncements, 30000);

  const postBtn = document.getElementById('announcement-compose-post-btn');
  const titleInput = document.getElementById('announcement-compose-title');
  const bodyInput = document.getElementById('announcement-compose-body');
  const feedback = document.getElementById('announcement-compose-feedback');
  const composeModalEl = document.getElementById('announcement-compose-modal');
  composeModalEl.addEventListener('show.bs.modal', () => {
    titleInput.value = '';
    bodyInput.value = '';
    feedback.textContent = '';
    feedback.className = 'settings-feedback';
  });
  postBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title || !body) {
      feedback.textContent = 'Title and body are required.';
      feedback.className = 'settings-feedback text-danger';
      return;
    }
    const basePath = location.pathname.replace(/\/$/, '');
    postBtn.disabled = true;
    feedback.textContent = 'Posting…';
    feedback.className = 'settings-feedback';
    try {
      const res = await fetch(`${basePath}/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error('post failed');
      feedback.textContent = 'Posted.';
      feedback.className = 'settings-feedback text-success';
      await fetchAnnouncements();
      setTimeout(() => bootstrap.Modal.getInstance(composeModalEl)?.hide(), 400);
    } catch {
      feedback.textContent = 'Failed to post.';
      feedback.className = 'settings-feedback text-danger';
    } finally {
      postBtn.disabled = false;
    }
  });
}

// Update ticking timers every 1 second.
// Tick paths only touch time-relative cells in place (no innerHTML), so a text
// selection elsewhere in the table survives — needed so agents can copy/paste
// names, phone numbers, SF case IDs, etc. Full renders fire on WS push.
// renderStats / renderRepeatCallers have no ticking content and are intentionally
// not called here; they redraw on the next WS push.
setInterval(() => {
  renderAgentsTick();
  renderQueueTick();
  renderLive();
  if (!selectedDate) {
    renderCallListTick();
  }
}, 1000);
// Load saved column preferences, then init
loadColPrefs();
init();
