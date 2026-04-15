let reportData = null;
let agentSortKey = 'callsHandled';
let agentSortDir = 'desc';
let volumeChart = null;
let agentCallsChart = null;
let agentTimeChart = null;

// -- Theme toggle --
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

// -- Helpers --
function formatSeconds(sec) {
  if (sec == null || sec === 0) return '--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// -- Date presets --
function getPresetRange(preset) {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun
  const toISO = (d) => d.toISOString().split('T')[0];

  if (preset === 'thisWeek') {
    const start = new Date(today);
    start.setDate(today.getDate() - ((dayOfWeek + 6) % 7)); // Monday
    return { startDate: toISO(start), endDate: toISO(today) };
  }
  if (preset === 'lastWeek') {
    const end = new Date(today);
    end.setDate(today.getDate() - ((dayOfWeek + 6) % 7) - 1); // Last Sunday
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { startDate: toISO(start), endDate: toISO(end) };
  }
  if (preset === 'thisMonth') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: toISO(start), endDate: toISO(today) };
  }
  if (preset === 'lastMonth') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { startDate: toISO(start), endDate: toISO(end) };
  }
  return null;
}

// -- API --
async function fetchReports(startDate, endDate, userId) {
  const basePath = location.pathname.replace(/\/[^/]*$/, '');
  let url = `${basePath}/api/reports?startDate=${startDate}&endDate=${endDate}`;
  if (userId) url += `&userId=${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch reports');
  }
  return res.json();
}

// -- Render: Call Volumes --
function renderCallVolumes(data) {
  const { daily, totals } = data;

  const cards = [
    { value: totals.total, label: 'Total Calls', cls: '' },
    { value: totals.inbound, label: 'Inbound', cls: 'stat-answered' },
    { value: totals.outbound, label: 'Outbound', cls: 'stat-outbound' },
    { value: totals.callbacks, label: 'Callbacks', cls: 'stat-callback' },
    { value: totals.abandoned, label: 'Missed / Abandoned', cls: 'stat-abandoned' },
  ];

  document.getElementById('volume-totals').innerHTML = cards.map((c) => `
    <div class="col"><div class="card stat-card ${c.cls} p-2">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div></div>
  `).join('');

  if (daily.length === 0) {
    document.getElementById('volume-daily-table').innerHTML = '<div class="empty">No call data for this period</div>';
    return;
  }

  let html = `<table class="table table-striped table-hover table-sm mb-0">
    <thead><tr>
      <th>Date</th><th class="text-center">Total</th><th class="text-center">Inbound</th>
      <th class="text-center">Outbound</th><th class="text-center">Callbacks</th><th class="text-center">Abandoned</th>
    </tr></thead><tbody>`;
  for (const day of daily) {
    html += `<tr>
      <td>${formatDate(day.date)}</td>
      <td class="text-center">${day.total}</td>
      <td class="text-center">${day.inbound}</td>
      <td class="text-center">${day.outbound}</td>
      <td class="text-center">${day.callbacks}</td>
      <td class="text-center">${day.abandoned}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  document.getElementById('volume-daily-table').innerHTML = html;
}

function isWeekday(dateStr) {
  const day = new Date(dateStr + 'T00:00:00').getDay();
  return day !== 0 && day !== 6;
}

function freshCanvas(id) {
  const old = document.getElementById(id);
  if (!old) return null;
  const canvas = document.createElement('canvas');
  canvas.id = id;
  old.parentNode.replaceChild(canvas, old);
  return canvas;
}

function renderVolumeChart(daily) {
  if (volumeChart) { volumeChart.destroy(); volumeChart = null; }
  const ctx = freshCanvas('volume-chart');
  if (!ctx) return;

  const weekdays = daily.filter((d) => isWeekday(d.date));
  const chartType = document.getElementById('volume-chart-type').value;
  const isDark = document.body.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const tickColor = isDark ? '#8899aa' : '#6b7280';
  const isLine = chartType === 'line';

  const labels = weekdays.map((d) => formatDate(d.date));

  const colors = {
    inbound: 'rgba(22,101,52,0.7)',
    outbound: 'rgba(3,105,161,0.7)',
    callbacks: 'rgba(146,64,14,0.7)',
    abandoned: 'rgba(153,27,27,0.7)',
  };

  const makeDataset = (label, key, color) => ({
    label,
    data: weekdays.map((d) => d[key]),
    backgroundColor: color,
    borderColor: isLine ? color : undefined,
    borderWidth: isLine ? 2 : undefined,
    borderRadius: isLine ? undefined : 3,
    fill: isLine,
    tension: isLine ? 0.3 : undefined,
    pointRadius: isLine ? 3 : undefined,
  });

  volumeChart = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [
        makeDataset('Inbound', 'inbound', colors.inbound),
        makeDataset('Outbound', 'outbound', colors.outbound),
        makeDataset('Callbacks', 'callbacks', colors.callbacks),
        makeDataset('Abandoned', 'abandoned', colors.abandoned),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { stacked: !isLine, grid: { display: false }, ticks: { color: tickColor } },
        y: { stacked: !isLine, beginAtZero: true, grid: { color: gridColor }, ticks: { color: tickColor } },
      },
    },
  });
}

// -- Render: Duration / Responsiveness --
function renderDuration(data) {
  const cards = [
    { value: formatSeconds(data.avgCallDuration), label: 'Avg Call Length', cls: '' },
    { value: formatSeconds(data.longestCallDuration), label: 'Longest Call', cls: '' },
    { value: formatSeconds(data.avgQueueTime), label: 'Avg Speed of Answer', cls: '' },
    { value: formatSeconds(data.longestQueueTime), label: 'Avg Queue Time', cls: '' },
  ];

  document.getElementById('duration-stats').innerHTML = cards.map((c) => `
    <div class="col-md-3 col-6"><div class="card stat-card ${c.cls} p-2">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div></div>
  `).join('');
}

// -- Render: Agent Activity --
const AGENT_COLUMNS = {
  agentName:       { label: 'Agent',            sortVal: (a) => a.agentName },
  callsHandled:    { label: 'Calls Handled',    sortVal: (a) => a.callsHandled },
  totalTalkTime:   { label: 'Total Talk Time',  sortVal: (a) => a.totalTalkTime },
  avgCallDuration: { label: 'Avg Call Length',   sortVal: (a) => a.avgCallDuration },
};

function renderAgentActivity(agents) {
  const container = document.getElementById('agent-activity-table');
  if (!agents || agents.length === 0) {
    container.innerHTML = '<div class="empty">No agent activity for this period</div>';
    return;
  }

  let sorted = [...agents];
  if (agentSortKey && AGENT_COLUMNS[agentSortKey]) {
    const sv = AGENT_COLUMNS[agentSortKey].sortVal;
    sorted.sort((a, b) => {
      const av = sv(a), bv = sv(b);
      if (av < bv) return agentSortDir === 'asc' ? -1 : 1;
      if (av > bv) return agentSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const colKeys = Object.keys(AGENT_COLUMNS);
  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr>';
  for (const key of colKeys) {
    const active = agentSortKey === key;
    const indicator = active ? (agentSortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
    html += `<th class="sort-th${active ? ' sort-active' : ''}" data-sort-key="${key}">${AGENT_COLUMNS[key].label}${indicator}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const agent of sorted) {
    html += `<tr>
      <td>${agent.agentName}</td>
      <td class="text-center">${agent.callsHandled}</td>
      <td class="text-center">${formatSeconds(agent.totalTalkTime)}</td>
      <td class="text-center">${formatSeconds(agent.avgCallDuration)}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort-key]');
    if (!th) return;
    const key = th.dataset.sortKey;
    if (agentSortKey === key) {
      if (agentSortDir === 'asc') {
        agentSortDir = 'desc';
      } else {
        agentSortKey = null;
        agentSortDir = 'asc';
      }
    } else {
      agentSortKey = key;
      agentSortDir = 'asc';
    }
    renderAgentActivity(reportData.agentActivity);
  });
}

const AGENT_PALETTE = [
  'rgba(0,120,212,0.75)',   // blue
  'rgba(22,163,74,0.75)',   // green
  'rgba(147,51,234,0.75)',  // purple
  'rgba(234,88,12,0.75)',   // orange
  'rgba(6,182,212,0.75)',   // cyan
  'rgba(168,85,247,0.75)',  // violet
  'rgba(14,165,233,0.75)',  // sky
  'rgba(245,158,11,0.75)',  // amber
  'rgba(16,185,129,0.75)',  // emerald
  'rgba(99,102,241,0.75)',  // indigo
];

function agentColor(index) {
  return AGENT_PALETTE[index % AGENT_PALETTE.length];
}

function renderAgentChart() {
  if (agentCallsChart) { agentCallsChart.destroy(); agentCallsChart = null; }
  if (agentTimeChart) { agentTimeChart.destroy(); agentTimeChart = null; }
  const callsCtx = freshCanvas('agent-calls-chart');
  const timeCtx = freshCanvas('agent-time-chart');
  if (!callsCtx || !timeCtx) return;

  const agents = reportData?.agentActivity;
  const agentDailyData = reportData?.agentDaily;
  const allDates = reportData?.allDates;
  if (!agents || agents.length === 0) return;

  const chartType = document.getElementById('agent-chart-type').value;
  const isDark = document.body.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const tickColor = isDark ? '#8899aa' : '#6b7280';
  const isLine = chartType === 'line';
  const isDoughnut = chartType === 'doughnut';

  const sorted = [...agents].sort((a, b) => b.callsHandled - a.callsHandled);
  const count = sorted.length;

  if (isDoughnut) {
    const labels = sorted.map((a) => a.agentName);
    const colors = sorted.map((_, i) => agentColor(i));
    const doughnutOpts = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: tickColor, font: { size: 11 } } } },
    };
    agentCallsChart = new Chart(callsCtx, {
      type: 'doughnut',
      data: { labels, datasets: [{ label: 'Calls Handled', data: sorted.map((a) => a.callsHandled), backgroundColor: colors }] },
      options: { ...doughnutOpts, plugins: { ...doughnutOpts.plugins, title: { display: true, text: 'Calls Handled', color: tickColor } } },
    });
    agentTimeChart = new Chart(timeCtx, {
      type: 'doughnut',
      data: { labels, datasets: [{ label: 'Talk Time (min)', data: sorted.map((a) => Math.round(a.totalTalkTime / 60)), backgroundColor: colors }] },
      options: { ...doughnutOpts, plugins: { ...doughnutOpts.plugins, title: { display: true, text: 'Talk Time (min)', color: tickColor } } },
    });
    return;
  }

  const avgLineStyle = { borderColor: 'rgba(250,204,21,1)', borderWidth: 3, borderDash: [8, 4], pointRadius: 0, fill: false, order: 0 };

  if (isLine && agentDailyData && allDates && allDates.length > 1) {
    // Filter out weekends
    const weekdayIndices = [];
    const weekdayDates = allDates.filter((d, i) => { if (isWeekday(d)) { weekdayIndices.push(i); return true; } return false; });
    const dateLabels = weekdayDates.map((d) => formatDate(d));
    const agentCount = agentDailyData.length;

    const callsDatasets = agentDailyData.map((agent, i) => ({
      label: agent.agentName,
      data: weekdayIndices.map((di) => agent.daily[di].calls),
      borderColor: agentColor(i),
      backgroundColor: agentColor(i),
      borderWidth: 2, tension: 0.3, pointRadius: 3, fill: false,
    }));
    const timeDatasets = agentDailyData.map((agent, i) => ({
      label: agent.agentName,
      data: weekdayIndices.map((di) => Math.round(agent.daily[di].talkTime / 60)),
      borderColor: agentColor(i),
      backgroundColor: agentColor(i),
      borderWidth: 2, tension: 0.3, pointRadius: 3, fill: false,
    }));

    // Team average per day (weekdays only)
    const avgCalls = weekdayIndices.map((di) => {
      const sum = agentDailyData.reduce((s, a) => s + a.daily[di].calls, 0);
      return Math.round((sum / agentCount) * 10) / 10;
    });
    const avgTime = weekdayIndices.map((di) => {
      const sum = agentDailyData.reduce((s, a) => s + a.daily[di].talkTime, 0);
      return Math.round(sum / agentCount / 60 * 10) / 10;
    });

    callsDatasets.push({ label: 'Team Avg', data: avgCalls, ...avgLineStyle });
    timeDatasets.push({ label: 'Team Avg', data: avgTime, ...avgLineStyle });

    const lineOpts = (title, yLabel) => ({
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor, font: { size: 11 } } }, title: { display: true, text: title, color: tickColor } },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor } },
        y: { beginAtZero: true, title: { display: true, text: yLabel, color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      },
    });

    agentCallsChart = new Chart(callsCtx, { type: 'line', data: { labels: dateLabels, datasets: callsDatasets }, options: lineOpts('Calls Handled', 'Calls') });
    agentTimeChart = new Chart(timeCtx, { type: 'line', data: { labels: dateLabels, datasets: timeDatasets }, options: lineOpts('Talk Time', 'Minutes') });
    return;
  }

  const isStacked = chartType === 'stacked';

  if (isStacked && agentDailyData && allDates && allDates.length > 1) {
    // Stacked bar: each agent is a dataset, x-axis = weekdays
    const weekdayIndices = [];
    const weekdayDates = allDates.filter((d, i) => { if (isWeekday(d)) { weekdayIndices.push(i); return true; } return false; });
    const dateLabels = weekdayDates.map((d) => formatDate(d));
    const agentCount = agentDailyData.length;

    const callsDatasets = agentDailyData.map((agent, i) => ({
      label: agent.agentName,
      data: weekdayIndices.map((di) => agent.daily[di].calls),
      backgroundColor: agentColor(i),
      borderRadius: 2,
    }));
    const timeDatasets = agentDailyData.map((agent, i) => ({
      label: agent.agentName,
      data: weekdayIndices.map((di) => Math.round(agent.daily[di].talkTime / 60)),
      backgroundColor: agentColor(i),
      borderRadius: 2,
    }));

    // Team average per day
    const avgCalls = weekdayIndices.map((di) => {
      const sum = agentDailyData.reduce((s, a) => s + a.daily[di].calls, 0);
      return Math.round((sum / agentCount) * 10) / 10;
    });
    const avgTime = weekdayIndices.map((di) => {
      const sum = agentDailyData.reduce((s, a) => s + a.daily[di].talkTime, 0);
      return Math.round(sum / agentCount / 60 * 10) / 10;
    });

    callsDatasets.push({ label: 'Team Avg', type: 'line', data: avgCalls, ...avgLineStyle });
    timeDatasets.push({ label: 'Team Avg', type: 'line', data: avgTime, ...avgLineStyle });

    const stackedOpts = (title, yLabel) => ({
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor, font: { size: 11 } } }, title: { display: true, text: title, color: tickColor } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: tickColor } },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: yLabel, color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      },
    });

    agentCallsChart = new Chart(callsCtx, { type: 'bar', data: { labels: dateLabels, datasets: callsDatasets }, options: stackedOpts('Calls Handled', 'Calls') });
    agentTimeChart = new Chart(timeCtx, { type: 'bar', data: { labels: dateLabels, datasets: timeDatasets }, options: stackedOpts('Talk Time', 'Minutes') });
    return;
  }

  // Bar chart: agents on x-axis with average line
  const labels = sorted.map((a) => a.agentName);
  const avgCalls = Math.round(sorted.reduce((s, a) => s + a.callsHandled, 0) / count * 10) / 10;
  const avgTime = Math.round(sorted.reduce((s, a) => s + a.totalTalkTime, 0) / count / 60 * 10) / 10;

  const barOpts = (title, yLabel) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: tickColor, font: { size: 11 } } }, title: { display: true, text: title, color: tickColor } },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor } },
      y: { beginAtZero: true, title: { display: true, text: yLabel, color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
    },
  });

  agentCallsChart = new Chart(callsCtx, {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Calls Handled', data: sorted.map((a) => a.callsHandled), backgroundColor: sorted.map((_, i) => agentColor(i)), borderRadius: 3 },
      { label: `Avg (${avgCalls})`, type: 'line', data: Array(count).fill(avgCalls), ...avgLineStyle },
    ] },
    options: barOpts('Calls Handled', 'Calls'),
  });
  agentTimeChart = new Chart(timeCtx, {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Talk Time (min)', data: sorted.map((a) => Math.round(a.totalTalkTime / 60)), backgroundColor: sorted.map((_, i) => agentColor(i)), borderRadius: 3 },
      { label: `Avg (${avgTime})`, type: 'line', data: Array(count).fill(avgTime), ...avgLineStyle },
    ] },
    options: barOpts('Talk Time', 'Minutes'),
  });
}

// -- Render: Salesforce Cases --
let caseSearch = '';
let caseSortKey = 'createdDate';
let caseSortDir = 'desc';

const CASE_COLUMNS = {
  caseNumber:  { label: 'Case #',      sortVal: (c) => c.caseNumber || '' },
  status:      { label: 'Status',      sortVal: (c) => c.status || '' },
  accountName: { label: 'Account',     sortVal: (c) => c.accountName || '' },
  techName:    { label: 'Tech',        sortVal: (c) => c.techName || '' },
  ownerName:   { label: 'Owner',       sortVal: (c) => c.ownerName || '' },
  createdDate: { label: 'Created',     sortVal: (c) => c.createdDate ? new Date(c.createdDate).getTime() : 0 },
  closedDate:  { label: 'Closed',      sortVal: (c) => c.closedDate ? new Date(c.closedDate).getTime() : 0 },
};

function formatCaseDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderCases(data) {
  const { stats, records } = data;

  // Stats cards
  const cards = [
    { value: stats.total, label: 'Total Cases', cls: '' },
    { value: stats.open, label: 'Open', cls: 'stat-outbound' },
    { value: stats.closed, label: 'Closed', cls: 'stat-answered' },
  ];
  document.getElementById('cases-stats').innerHTML = cards.map((c) => `
    <div class="col"><div class="card stat-card ${c.cls} p-2">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div></div>
  `).join('');
  document.getElementById('cases-count').textContent = stats.total;

  renderCaseTable(records);
}

function renderCaseTable(records) {
  const container = document.getElementById('cases-table');
  if (!records || records.length === 0) {
    container.innerHTML = '<div class="empty">No cases for this period</div>';
    return;
  }

  // Filter
  const q = caseSearch.toLowerCase().trim();
  const filtered = q ? records.filter((c) =>
    [c.caseNumber, c.status, c.accountName, c.techName, c.ownerName, c.subject]
      .some((v) => v && v.toLowerCase().includes(q))
  ) : records;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">No cases match your search</div>';
    return;
  }

  // Sort
  let sorted = filtered;
  if (caseSortKey && CASE_COLUMNS[caseSortKey]) {
    const sv = CASE_COLUMNS[caseSortKey].sortVal;
    sorted = [...filtered].sort((a, b) => {
      const av = sv(a), bv = sv(b);
      if (av < bv) return caseSortDir === 'asc' ? -1 : 1;
      if (av > bv) return caseSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const colKeys = Object.keys(CASE_COLUMNS);
  let html = '<table class="table table-striped table-hover table-sm mb-0"><thead><tr>';
  for (const key of colKeys) {
    const active = caseSortKey === key;
    const indicator = active ? (caseSortDir === 'asc' ? ' &#9650;' : ' &#9660;') : '';
    html += `<th class="sort-th${active ? ' sort-active' : ''}" data-case-sort="${key}">${CASE_COLUMNS[key].label}${indicator}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const c of sorted) {
    const sfLink = `https://ipdatatel.lightning.force.com/lightning/r/Case/${c.id}/view`;
    html += `<tr>
      <td><a href="${sfLink}" target="_blank" rel="noopener">${c.caseNumber || '--'}</a></td>
      <td>${c.status || '--'}</td>
      <td>${c.accountName}</td>
      <td>${c.techName}</td>
      <td>${c.ownerName}</td>
      <td>${formatCaseDate(c.createdDate)}</td>
      <td>${formatCaseDate(c.closedDate)}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelector('thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-case-sort]');
    if (!th) return;
    const key = th.dataset.caseSort;
    if (caseSortKey === key) {
      if (caseSortDir === 'asc') {
        caseSortDir = 'desc';
      } else {
        caseSortKey = null;
        caseSortDir = 'asc';
      }
    } else {
      caseSortKey = key;
      caseSortDir = 'asc';
    }
    renderCaseTable(reportData.cases.records);
  });
}

// -- Export helpers --
function getMetadata() {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const select = document.getElementById('team-member-select');
  const teamMember = select.options[select.selectedIndex]?.text || 'All Team';
  return { startDate, endDate, teamMember, generatedAt: new Date().toLocaleString() };
}

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function getExportFilename(ext) {
  const s = document.getElementById('start-date').value;
  const e = document.getElementById('end-date').value;
  return `report_${s}_${e}.${ext}`;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -- CSV Export --
function exportCSV() {
  if (!reportData) return;
  const meta = getMetadata();
  const rows = [];
  const row = (...cols) => rows.push(cols.map(escapeCSV).join(','));
  const blank = () => rows.push('');

  // Metadata
  row('Report Generated', meta.generatedAt);
  row('Date Range', `${meta.startDate} to ${meta.endDate}`);
  row('Team Member', meta.teamMember);
  blank();

  // Call Volumes - Totals
  row('CALL VOLUMES - TOTALS');
  row('Total', 'Inbound', 'Outbound', 'Callbacks', 'Abandoned');
  const t = reportData.callVolumes.totals;
  row(t.total, t.inbound, t.outbound, t.callbacks, t.abandoned);
  blank();

  // Call Volumes - Daily
  row('CALL VOLUMES - DAILY');
  row('Date', 'Total', 'Inbound', 'Outbound', 'Callbacks', 'Abandoned');
  for (const d of reportData.callVolumes.daily) {
    row(d.date, d.total, d.inbound, d.outbound, d.callbacks, d.abandoned);
  }
  blank();

  // Duration
  row('DURATION / RESPONSIVENESS');
  row('Avg Call Length', 'Longest Call', 'Avg Speed of Answer', 'Avg Queue Time');
  const dur = reportData.duration;
  row(formatSeconds(dur.avgCallDuration), formatSeconds(dur.longestCallDuration), formatSeconds(dur.avgQueueTime), formatSeconds(dur.longestQueueTime));
  blank();

  // Agent Activity
  row('AGENT ACTIVITY');
  row('Agent', 'Calls Handled', 'Total Talk Time', 'Avg Call Length');
  for (const a of reportData.agentActivity) {
    row(a.agentName, a.callsHandled, formatSeconds(a.totalTalkTime), formatSeconds(a.avgCallDuration));
  }
  blank();

  // Cases Summary
  row('SALESFORCE CASES - SUMMARY');
  row('Total', 'Open', 'Closed');
  const cs = reportData.cases.stats;
  row(cs.total, cs.open, cs.closed);
  blank();

  // Case Records
  row('SALESFORCE CASES - RECORDS');
  row('Case #', 'Status', 'Account', 'Tech', 'Owner', 'Created', 'Closed');
  for (const c of reportData.cases.records) {
    row(c.caseNumber, c.status, c.accountName, c.techName, c.ownerName, formatCaseDate(c.createdDate), formatCaseDate(c.closedDate));
  }

  downloadBlob(rows.join('\n'), getExportFilename('csv'), 'text/csv;charset=utf-8;');
}

// -- PDF Export --
function exportPDF() {
  if (!reportData) return;
  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
    alert('PDF library failed to load. Please check your internet connection and refresh.');
    return;
  }

  const { jsPDF } = window.jspdf || jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageHeight = doc.internal.pageSize.height;
  const meta = getMetadata();
  const blue = [0, 120, 212];

  // Title
  doc.setFontSize(18);
  doc.text('Report', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Date Range: ${meta.startDate} to ${meta.endDate}`, 14, 26);
  doc.text(`Team Member: ${meta.teamMember}`, 14, 32);
  doc.text(`Generated: ${meta.generatedAt}`, 14, 38);
  doc.setTextColor(0);

  let yPos = 46;

  function sectionHeading(title) {
    if (yPos > pageHeight - 30) {
      doc.addPage();
      yPos = 14;
    }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(title, 14, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 6;
  }

  const tableOpts = {
    startY: () => yPos,
    headStyles: { fillColor: blue, fontSize: 8 },
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  };

  // Call Volumes - Totals
  sectionHeading('Call Volumes - Totals');
  const t = reportData.callVolumes.totals;
  doc.autoTable({
    ...tableOpts, startY: yPos,
    head: [['Total', 'Inbound', 'Outbound', 'Callbacks', 'Abandoned']],
    body: [[t.total, t.inbound, t.outbound, t.callbacks, t.abandoned]],
  });
  yPos = doc.lastAutoTable.finalY + 8;

  // Call Volumes - Daily
  sectionHeading('Call Volumes - Daily');
  doc.autoTable({
    ...tableOpts, startY: yPos,
    head: [['Date', 'Total', 'Inbound', 'Outbound', 'Callbacks', 'Abandoned']],
    body: reportData.callVolumes.daily.map((d) => [d.date, d.total, d.inbound, d.outbound, d.callbacks, d.abandoned]),
  });
  yPos = doc.lastAutoTable.finalY + 8;

  // Duration
  sectionHeading('Duration / Responsiveness');
  const dur = reportData.duration;
  doc.autoTable({
    ...tableOpts, startY: yPos,
    head: [['Avg Call Length', 'Longest Call', 'Avg Speed of Answer', 'Avg Queue Time']],
    body: [[formatSeconds(dur.avgCallDuration), formatSeconds(dur.longestCallDuration), formatSeconds(dur.avgQueueTime), formatSeconds(dur.longestQueueTime)]],
  });
  yPos = doc.lastAutoTable.finalY + 8;

  // Agent Activity
  sectionHeading('Agent Activity');
  doc.autoTable({
    ...tableOpts, startY: yPos,
    head: [['Agent', 'Calls Handled', 'Total Talk Time', 'Avg Call Length']],
    body: reportData.agentActivity.map((a) => [a.agentName, a.callsHandled, formatSeconds(a.totalTalkTime), formatSeconds(a.avgCallDuration)]),
  });
  yPos = doc.lastAutoTable.finalY + 8;

  // Cases Summary
  sectionHeading('Salesforce Cases - Summary');
  const cs = reportData.cases.stats;
  doc.autoTable({
    ...tableOpts, startY: yPos,
    head: [['Total', 'Open', 'Closed']],
    body: [[cs.total, cs.open, cs.closed]],
  });
  yPos = doc.lastAutoTable.finalY + 8;

  // Case Records
  if (reportData.cases.records.length > 0) {
    sectionHeading('Salesforce Cases - Records');
    doc.autoTable({
      ...tableOpts, startY: yPos,
      head: [['Case #', 'Status', 'Account', 'Tech', 'Owner', 'Created', 'Closed']],
      body: reportData.cases.records.map((c) => [c.caseNumber, c.status, c.accountName, c.techName, c.ownerName, formatCaseDate(c.createdDate), formatCaseDate(c.closedDate)]),
    });
  }

  doc.save(getExportFilename('pdf'));
}

// -- Team member dropdown --
function populateTeamDropdown(userList) {
  const select = document.getElementById('team-member-select');
  const currentVal = select.value;
  // Keep "All Team" option, replace the rest
  select.innerHTML = '<option value="">All Team</option>';
  for (const user of userList) {
    const opt = document.createElement('option');
    opt.value = user.id;
    opt.textContent = user.name;
    select.appendChild(opt);
  }
  // Restore previous selection if still valid
  if (currentVal && [...select.options].some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }
}

// -- Generate report --
async function generateReport() {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const userId = document.getElementById('team-member-select').value;
  if (!startDate || !endDate) return;

  document.getElementById('reports-data').style.display = 'none';
  document.getElementById('reports-loading').style.display = '';

  try {
    reportData = await fetchReports(startDate, endDate, userId);
    // Populate dropdown from the user list
    if (reportData.userList && reportData.userList.length > 0) {
      populateTeamDropdown(reportData.userList);
    }
    renderCallVolumes(reportData.callVolumes);
    renderDuration(reportData.duration);
    renderAgentActivity(reportData.agentActivity);
    renderCases(reportData.cases);
    // Show container before rendering charts so Chart.js can measure dimensions
    document.getElementById('reports-data').style.display = '';
    renderVolumeChart(reportData.callVolumes.daily);
    renderAgentChart();
    document.getElementById('export-csv-btn').disabled = false;
    document.getElementById('export-pdf-btn').disabled = false;
  } catch (err) {
    console.error('Failed to generate report:', err);
    document.getElementById('reports-data').innerHTML = `<div class="card"><div class="card-body text-center text-danger py-4">${err.message}</div></div>`;
    document.getElementById('reports-data').style.display = '';
    document.getElementById('export-csv-btn').disabled = true;
    document.getElementById('export-pdf-btn').disabled = true;
  } finally {
    document.getElementById('reports-loading').style.display = 'none';
  }
}

// -- Init --
async function init() {
  const basePath = location.pathname.replace(/\/[^/]*$/, '');
  try {
    const res = await fetch(`${basePath}/api/me`);
    const user = await res.json();

    if (!user?.superAdmin && !user?.supervisor) {
      document.getElementById('access-denied').style.display = '';
      return;
    }

    // Populate profile
    if (user?.name) {
      const initials = user.name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
      document.getElementById('ms-avatar').textContent = initials;
      document.getElementById('ms-avatar-lg').textContent = initials;
      document.getElementById('ms-profile-name').textContent = user.name;
    }
    if (user?.email) {
      document.getElementById('ms-profile-email').textContent = user.email;
    }

    document.getElementById('reports-content').style.display = '';

    // Set max dates to today
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('start-date').max = todayStr;
    document.getElementById('end-date').max = todayStr;

    // Set default date range (this month) and populate hidden inputs
    const range = getPresetRange('thisMonth');
    document.getElementById('start-date').value = range.startDate;
    document.getElementById('end-date').value = range.endDate;

    // Date range dropdown
    const dateRangeSelect = document.getElementById('date-range-select');
    const customDateRange = document.getElementById('custom-date-range');

    function applyDateRange() {
      const val = dateRangeSelect.value;
      if (val === 'custom') {
        customDateRange.style.display = '';
        customDateRange.style.setProperty('display', 'flex', 'important');
      } else {
        customDateRange.style.setProperty('display', 'none', 'important');
        const r = getPresetRange(val);
        if (r) {
          document.getElementById('start-date').value = r.startDate;
          document.getElementById('end-date').value = r.endDate;
        }
      }
      generateReport();
    }

    dateRangeSelect.addEventListener('change', applyDateRange);

    // Custom date inputs auto-generate
    document.getElementById('start-date').addEventListener('change', generateReport);
    document.getElementById('end-date').addEventListener('change', generateReport);

    // Case search
    document.getElementById('case-search').addEventListener('input', (e) => {
      caseSearch = e.target.value;
      if (reportData?.cases?.records) renderCaseTable(reportData.cases.records);
    });

    // Team member dropdown
    document.getElementById('team-member-select').addEventListener('change', generateReport);

    // Export buttons
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
    document.getElementById('export-pdf-btn').addEventListener('click', exportPDF);

    // Chart type pickers (restore saved preference and re-render on change)
    document.querySelectorAll('.chart-type-select').forEach((select) => {
      const saved = localStorage.getItem(`chart_type_${select.id}`);
      if (saved && [...select.options].some((o) => o.value === saved)) {
        select.value = saved;
      }
      select.addEventListener('change', () => {
        localStorage.setItem(`chart_type_${select.id}`, select.value);
        if (reportData) {
          if (select.id === 'volume-chart-type') renderVolumeChart(reportData.callVolumes.daily);
          if (select.id === 'agent-chart-type') renderAgentChart();
        }
      });
    });

    // Chart toggle buttons
    document.querySelectorAll('.chart-toggle').forEach((btn) => {
      const targetId = btn.dataset.target;
      const hidden = localStorage.getItem(`chart_hidden_${targetId}`) === '1';
      if (hidden) {
        document.getElementById(targetId).style.display = 'none';
        btn.textContent = 'Show Chart';
      }
      btn.addEventListener('click', () => {
        const el = document.getElementById(targetId);
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? '' : 'none';
        btn.textContent = isHidden ? 'Hide Chart' : 'Show Chart';
        localStorage.setItem(`chart_hidden_${targetId}`, isHidden ? '0' : '1');
      });
    });

    // Auto-generate on load
    generateReport();
  } catch (e) {
    console.error('Failed to initialize reports:', e);
  }
}

init();
