let dashboardData = { agents: [], queue: [], stats: {}, callLists: {} };

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
  const container = document.getElementById('recent-calls-table');
  const selected = document.getElementById('call-list-select').value;
  const calls = (dashboardData.callLists || {})[selected] || [];

  if (calls.length === 0) {
    container.innerHTML = '<div class="empty">No calls to display</div>';
    return;
  }

  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr><th>Caller</th><th>Company</th><th>Agent</th><th>Call Duration</th><th>Queue Wait</th><th>Ended</th></tr></thead><tbody>';
  for (const call of calls) {
    html += `<tr>
      <td>${call.callerName || '--'}</td>
      <td>${call.companyName || '--'}</td>
      <td>${call.agentName || '--'}</td>
      <td>${formatSeconds(call.duration)}</td>
      <td>${formatSeconds(call.queueDuration)}</td>
      <td>${formatTimeAgo(call.endTime)}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

document.getElementById('call-list-select').addEventListener('change', renderCallList);

function render() {
  renderAgents();
  renderQueue();
  renderLive();
  renderStats();
  renderCallList();
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
// Connect WebSocket
connectWebSocket();
