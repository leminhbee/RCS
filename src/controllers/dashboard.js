const atp = require('../ATP');
const { sfdcConn } = require('../config/sfdc');
const { broadcast } = require('../helpers/websocket');
const { clearCallbackTimer } = require('../helpers/callback_timers');
const { getVisibilityConfig, canAccess, getPermissions } = require('../helpers/dashboardAccess');

const OFFLINE_STATUSES = [null, 'LOGOUT', 'OFF-LINE'];
const SUPERVISOR_VISIBLE_STATUSES = ['AVAILABLE', 'ENGAGED'];

const maskNumber = (number) => {
  if (!number) return null;
  const digits = number.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `${digits[0]}(${digits.slice(1, 4)})${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length > 11) {
    return `+${digits.slice(0, -10)}(${digits.slice(-10, -7)})${digits.slice(-7, -4)}-${digits.slice(-4)}`;
  }
  return number;
};

const fetchDashboardData = async (date) => {
  const dayStart = new Date(date || new Date());
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [users, activeCalls, finishedCalls] = await Promise.all([
    atp.users.fetchAll({ callsActive: true }),
    atp.calls.fetchAll({ status: ['QUEUED', 'CALLBACK_REQUESTED', 'RINGING', 'ACTIVE'] }),
    atp.calls.fetchAll({
      status: ['COMPLETE', 'ABANDONED', 'CALLBACK_FAILED'],
      startTime: { $gte: dayStart.toISOString(), $lt: dayEnd.toISOString() },
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

  // Count answered calls per agent today (completed + currently active)
  const callsAnsweredByUser = {};
  const outboundByUser = {};
  for (const call of finishedCalls) {
    if (call.status === 'COMPLETE' && call.userId) {
      if (call.outbound) {
        outboundByUser[call.userId] = (outboundByUser[call.userId] || 0) + 1;
      } else {
        callsAnsweredByUser[call.userId] = (callsAnsweredByUser[call.userId] || 0) + 1;
      }
    }
  }
  for (const call of activeCalls) {
    if (call.status === 'ACTIVE' && call.userId) {
      callsAnsweredByUser[call.userId] = (callsAnsweredByUser[call.userId] || 0) + 1;
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
      lastLogin: u.lastLogin,
      activeCall: activeCallsByUser[u.id] || null,
      callsAnswered: callsAnsweredByUser[u.id] || 0,
      outboundCalls: outboundByUser[u.id] || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Queue: QUEUED, CALLBACK_REQUESTED, and RINGING calls, ordered by entry time
  const queue = activeCalls
    .filter((c) => c.status === 'QUEUED' || c.status === 'CALLBACK_REQUESTED' || c.status === 'RINGING')
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .map((c) => ({
      id: c.id,
      callerNumber: maskNumber(c.callerNumber),
      callerName: c.callerName,
      companyName: c.companyName,
      startTime: c.startTime,
      callbackRequested: c.status === 'CALLBACK_REQUESTED',
      ringing: c.status === 'RINGING',
    }));

  // Stats: only include active calls in stats when viewing today
  const now = new Date();
  const isViewingToday = dayStart.getFullYear() === now.getFullYear() &&
    dayStart.getMonth() === now.getMonth() &&
    dayStart.getDate() === now.getDate();
  const dayActive = isViewingToday ? activeCalls.filter((c) => c.status === 'ACTIVE' && new Date(c.startTime) >= dayStart) : [];
  const answered = finishedCalls.filter((c) => c.status === 'COMPLETE');
  const abandoned = finishedCalls.filter((c) => c.status === 'ABANDONED');
  const callbackFailed = finishedCalls.filter((c) => c.status === 'CALLBACK_FAILED');

  const queueTimes = finishedCalls.map((c) => c.queueDuration).filter((d) => d != null);
  const callDurations = answered.map((c) => c.duration).filter((d) => d != null);

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  const allDayCalls = [...dayActive, ...finishedCalls];

  // Build call count by caller number (masked keys for direct frontend lookup)
  const userMap = {};
  for (const u of users) userMap[u.id] = u;

  const mapCall = (c) => {
    const agent = userMap[c.userId];
    return {
      callerNumber: maskNumber(c.callerNumber),
      callerName: c.callerName,
      companyName: c.companyName,
      agentName: agent ? `${agent.nameFirst} ${agent.nameLast}` : '--',
      duration: c.duration,
      queueDuration: c.queueDuration,
      startTime: c.startTime,
      endTime: c.endTime,
      status: c.status || null,
      outbound: c.outbound || false,
      callbackRequested: c.callBackRequested || false,
      salesforceCaseId: c.salesforceCaseId || null,
      salesforceCaseNumber: c.salesforceCaseNumber || null,
      callLink: c.callLink || null,
    };
  };

  const callCountByNumber = {};
  const callsByNumber = {};
  for (const call of allDayCalls) {
    const masked = maskNumber(call.callerNumber);
    if (!masked) continue;
    callCountByNumber[masked] = (callCountByNumber[masked] || 0) + 1;
    if (!callsByNumber[masked]) callsByNumber[masked] = [];
    callsByNumber[masked].push(call);
  }
  // Also count queued/ringing calls (not in allDayCalls)
  for (const call of activeCalls) {
    if (call.status === 'QUEUED' || call.status === 'CALLBACK_REQUESTED' || call.status === 'RINGING') {
      const masked = maskNumber(call.callerNumber);
      if (!masked) continue;
      callCountByNumber[masked] = (callCountByNumber[masked] || 0) + 1;
      if (!callsByNumber[masked]) callsByNumber[masked] = [];
      callsByNumber[masked].push(call);
    }
  }

  const repeatCallers = Object.entries(callCountByNumber)
    .filter(([, count]) => count > 1)
    .map(([maskedNumber, count]) => {
      const calls = callsByNumber[maskedNumber];
      const sorted = [...calls].sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      return {
        callerNumber: maskedNumber,
        companyName: sorted[0].companyName || '--',
        callerName: sorted[0].callerName || '--',
        count,
        calls: sorted.map(mapCall),
      };
    })
    .sort((a, b) => b.count - a.count);

  const stats = {
    totalCalls: allDayCalls.length,
    totalAnswered: answered.filter((c) => !c.outbound).length + dayActive.filter((c) => c.status === 'ACTIVE').length,
    totalOutbound: answered.filter((c) => c.outbound).length,
    totalAbandoned: abandoned.length,
    totalCallbackFailed: callbackFailed.length,
    totalCallbacks: allDayCalls.filter((c) => c.callBackRequested).length,
    avgQueueTime: avg(queueTimes),
    longestQueueTime: queueTimes.length ? Math.max(...queueTimes) : 0,
    avgCallDuration: avg(callDurations),
    longestCallDuration: callDurations.length ? Math.max(...callDurations) : 0,
  };

  // Call lists for dropdown views
  const callLists = {
    allCalls: [...allDayCalls].sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).map(mapCall),
    recentCalls: [...answered].sort((a, b) => new Date(b.endTime) - new Date(a.endTime)).slice(0, 5).map(mapCall),
    longestCalls: [...answered].sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 5).map(mapCall),
    longestQueue: [...finishedCalls].sort((a, b) => (b.queueDuration || 0) - (a.queueDuration || 0)).slice(0, 5).map(mapCall),
    abandonedCalls: [...abandoned].sort((a, b) => new Date(b.endTime) - new Date(a.endTime)).map(mapCall),
  };

  return { agents, queue, stats, callLists, callCountByNumber, repeatCallers };
};

const getData = async (req, res) => {
  try {
    const data = await fetchDashboardData();
    const config = await getVisibilityConfig();
    const user = req.session?.user;

    if (!canAccess(config.stats, user)) delete data.stats;
    if (!canAccess(config.callLists, user)) delete data.callLists;
    if (!canAccess(config.callCountByNumber, user)) delete data.callCountByNumber;
    if (!canAccess(config.repeatCallers, user)) delete data.repeatCallers;
    if (!canAccess(config.agentMetrics, user)) {
      for (const agent of data.agents) {
        delete agent.callsAnswered;
        delete agent.outboundCalls;
        delete agent.lastLogin;
      }
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

const removeQueueCall = async (req, res) => {
  try {
    const callRecord = await atp.calls.fetchOne(req.params.id);
    if (!callRecord) {
      return res.status(404).json({ error: 'Call record not found' });
    }

    clearCallbackTimer(callRecord.id);

    const status = callRecord.status === 'CALLBACK_REQUESTED' ? 'CALLBACK_FAILED' : 'ABANDONED';
    await atp.calls.update(callRecord.id, {
      status,
      endTime: new Date(),
    });

    if (callRecord.salesforceCaseId) {
      await sfdcConn.authorize({ grant_type: 'client_credentials' });
      await sfdcConn.sobject('Case').update({
        Id: callRecord.salesforceCaseId,
        Status: 'Closed',
      });
    }

    await broadcast();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove call from queue' });
  }
};

const getStats = async (req, res) => {
  try {
    const config = await getVisibilityConfig();
    if (!canAccess(config.stats, req.session?.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const date = req.query.date ? new Date(req.query.date + 'T00:00:00') : new Date();
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    const data = await fetchDashboardData(date);
    res.json({ stats: data.stats, callLists: data.callLists, callCountByNumber: data.callCountByNumber, repeatCallers: data.repeatCallers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats data' });
  }
};

module.exports = {
  getData,
  getStats,
  fetchDashboardData,
  removeQueueCall,
};
