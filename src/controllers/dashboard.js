const atp = require('../ATP');

const OFFLINE_STATUSES = [null, 'LOGOUT', 'OFF-LINE'];
const SUPERVISOR_VISIBLE_STATUSES = ['AVAILABLE', 'ENGAGED'];

const maskNumber = (number) => {
  if (!number) return null;
  return 'X'.repeat(number.length - 4) + number.slice(-4);
};

const fetchDashboardData = async () => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [users, activeCalls, finishedCalls] = await Promise.all([
    atp.users.fetchAll({ callsActive: true }),
    atp.calls.fetchAll({ status: ['QUEUED', 'CALLBACK_REQUESTED', 'RINGING', 'ACTIVE'] }),
    atp.calls.fetchAll({
      status: ['COMPLETE', 'ABANDONED'],
      startTimeAfter: todayStart.toISOString(),
    }),
  ]);

  // Build a map of active calls keyed by userId
  const activeCallsByUser = {};
  for (const call of activeCalls) {
    if ((call.status === 'ACTIVE' || call.status === 'RINGING') && call.userId) {
      activeCallsByUser[call.userId] = {
        callerNumber: maskNumber(call.callerNumber),
        callerName: call.callerName,
        companyName: call.companyName,
        startTime: call.startTime,
      };
    }
  }

  // Agents: logged-in users, supervisors only if available or on a call
  const agents = users
    .filter((u) => {
      if (OFFLINE_STATUSES.includes(u.currentStatus)) return false;
      if (u.supervisor) return SUPERVISOR_VISIBLE_STATUSES.includes(u.currentStatus);
      return true;
    })
    .map((u) => ({
      name: `${u.nameFirst} ${u.nameLast}`,
      status: u.currentStatus,
      statusSince: u.statusSince,
      supervisor: u.supervisor,
      activeCall: activeCallsByUser[u.id] || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Queue: QUEUED, CALLBACK_REQUESTED, and RINGING calls, ordered by entry time
  const queue = activeCalls
    .filter((c) => c.status === 'QUEUED' || c.status === 'CALLBACK_REQUESTED' || c.status === 'RINGING')
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .map((c) => ({
      callerNumber: maskNumber(c.callerNumber),
      callerName: c.callerName,
      companyName: c.companyName,
      startTime: c.startTime,
      callbackRequested: c.status === 'CALLBACK_REQUESTED',
      ringing: c.status === 'RINGING',
    }));

  // Stats: today's totals
  const todayActive = activeCalls.filter((c) => new Date(c.startTime) >= todayStart);
  const answered = finishedCalls.filter((c) => c.status === 'COMPLETE');
  const abandoned = finishedCalls.filter((c) => c.status === 'ABANDONED');

  const queueTimes = finishedCalls.map((c) => c.queueDuration).filter((d) => d != null);
  const callDurations = answered.map((c) => c.duration).filter((d) => d != null);

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  const stats = {
    totalCalls: todayActive.length + finishedCalls.length,
    totalAnswered: answered.length + todayActive.filter((c) => c.status === 'ACTIVE').length,
    totalAbandoned: abandoned.length,
    avgQueueTime: avg(queueTimes),
    longestQueueTime: queueTimes.length ? Math.max(...queueTimes) : 0,
    avgCallDuration: avg(callDurations),
    longestCallDuration: callDurations.length ? Math.max(...callDurations) : 0,
  };

  // Call lists for dropdown views
  const userMap = {};
  for (const u of users) userMap[u.id] = u;

  const mapCall = (c) => {
    const agent = userMap[c.userId];
    return {
      callerName: c.callerName,
      companyName: c.companyName,
      agentName: agent ? `${agent.nameFirst} ${agent.nameLast}` : '--',
      duration: c.duration,
      queueDuration: c.queueDuration,
      endTime: c.endTime,
    };
  };

  const callLists = {
    recentCalls: [...answered].sort((a, b) => new Date(b.endTime) - new Date(a.endTime)).slice(0, 5).map(mapCall),
    longestCalls: [...answered].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 5).map(mapCall),
    longestQueue: [...finishedCalls].sort((a, b) => (b.queueDuration || 0) - (a.queueDuration || 0)).slice(0, 5).map(mapCall),
    abandonedCalls: [...abandoned].sort((a, b) => new Date(b.endTime) - new Date(a.endTime)).slice(0, 5).map(mapCall),
  };

  return { agents, queue, stats, callLists };
};

const getData = async (req, res) => {
  try {
    const data = await fetchDashboardData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

module.exports = {
  getData,
  fetchDashboardData,
};
