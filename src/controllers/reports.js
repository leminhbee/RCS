const atp = require('../ATP');
const { sfdcConn } = require('../config/sfdc');
const { getVisibilityConfig, canViewAllUsers } = require('../helpers/dashboardAccess');

const MAX_RANGE_DAYS = 93;
const MAX_CALL_DURATION_SECONDS = 8 * 3600;

const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
const isSaneDuration = (d) => d != null && d <= MAX_CALL_DURATION_SECONDS;

const getReports = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    if (start > end) {
      return res.status(400).json({ error: 'startDate must be before endDate' });
    }

    const rangeMs = end.getTime() - start.getTime();
    if (rangeMs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` });
    }

    const rangeEnd = new Date(end);
    rangeEnd.setDate(rangeEnd.getDate() + 1);

    const callFilter = {
      status: ['COMPLETE', 'ABANDONED', 'CALLBACK_FAILED'],
      startTime: { $gte: start.toISOString(), $lt: rangeEnd.toISOString() },
    };

    const [teamCalls, users] = await Promise.all([
      atp.calls.fetchAll(callFilter),
      atp.users.fetchAll({}),
    ]);

    // User name map and supervisor set
    const userMap = {};
    const supervisorIds = new Set();
    for (const u of users) {
      userMap[u.id] = `${u.nameFirst} ${u.nameLast}`;
      if (u.supervisor) supervisorIds.add(u.id);
    }

    // Per-user views (volumes, duration, per-agent rows) use the filtered set;
    // team-average computations always use teamCalls so the avg line reflects the team.
    // Self-only users (per visibility config) cannot pick another user — force their own id.
    const visibilityConfig = await getVisibilityConfig();
    const canViewAll = canViewAllUsers(visibilityConfig.reports, req.session?.user);
    const filteredUserId = canViewAll
      ? (req.query.userId || null)
      : (req.session?.user?.id || null);
    const calls = filteredUserId
      ? teamCalls.filter((c) => c.userId === filteredUserId)
      : teamCalls;

    // Build user list for dropdown (only active agents). Self-only users get an
    // empty list so the UI can't offer them a way to switch agents.
    const userList = canViewAll
      ? users
        .filter((u) => u.callsActive)
        .map((u) => ({ id: u.id, name: `${u.nameFirst} ${u.nameLast}`.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    // --- Call Volumes ---
    const dailyMap = {};
    const totals = { total: 0, inbound: 0, outbound: 0, callbacks: 0, abandoned: 0 };

    for (const call of calls) {
      const day = call.startTime ? call.startTime.slice(0, 10) : null;
      if (!day) continue;

      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, total: 0, inbound: 0, outbound: 0, callbacks: 0, abandoned: 0 };
      }
      const d = dailyMap[day];

      d.total++;
      totals.total++;

      if (call.status === 'ABANDONED' || call.status === 'CALLBACK_FAILED') {
        d.abandoned++;
        totals.abandoned++;
      } else if (call.outbound) {
        d.outbound++;
        totals.outbound++;
      } else {
        d.inbound++;
        totals.inbound++;
      }

      if (call.callBackRequested) {
        d.callbacks++;
        totals.callbacks++;
      }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // --- Duration / Responsiveness ---
    // Drop calls with anomalous durations (e.g. records left open for days) so a
    // single bad timestamp doesn't poison the avg/max/long-call stats. The dropped
    // records are surfaced separately as `flaggedCalls` so admins can clean them up.
    const completedCalls = calls.filter((c) => c.status === 'COMPLETE');
    const flaggedCalls = completedCalls
      .filter((c) => c.duration != null && c.duration > MAX_CALL_DURATION_SECONDS)
      .map((c) => ({
        id: c.id,
        agentName: userMap[c.userId] || 'Unknown',
        startTime: c.startTime,
        duration: c.duration,
        callerNumber: c.callerNumber || null,
      }))
      .sort((a, b) => b.duration - a.duration);

    const answered = completedCalls.filter((c) => isSaneDuration(c.duration));
    const callDurations = answered.map((c) => c.duration);
    const queueTimes = calls.map((c) => c.queueDuration).filter(isSaneDuration);

    const duration = {
      avgCallDuration: avg(callDurations),
      longestCallDuration: callDurations.length ? Math.max(...callDurations) : 0,
      avgQueueTime: avg(queueTimes),
      longestQueueTime: queueTimes.length ? Math.max(...queueTimes) : 0,
      longCalls: callDurations.filter((d) => d >= 1800).length,
    };

    // --- Agent Activity ---
    const agentMap = {};
    const agentDailyMap = {}; // { userId: { date: { calls, talkTime, longCalls } } }
    for (const call of answered) {
      if (!call.userId) continue;
      if (supervisorIds.has(call.userId)) continue;
      if (!agentMap[call.userId]) {
        agentMap[call.userId] = { callsHandled: 0, totalTalkTime: 0, longCalls: 0 };
      }
      const a = agentMap[call.userId];
      a.callsHandled++;
      a.totalTalkTime += call.duration || 0;
      if ((call.duration || 0) >= 1800) a.longCalls++;

      // Daily breakdown per agent
      const day = call.startTime ? call.startTime.slice(0, 10) : null;
      if (day) {
        if (!agentDailyMap[call.userId]) agentDailyMap[call.userId] = {};
        if (!agentDailyMap[call.userId][day]) agentDailyMap[call.userId][day] = { calls: 0, talkTime: 0, longCalls: 0 };
        agentDailyMap[call.userId][day].calls++;
        agentDailyMap[call.userId][day].talkTime += call.duration || 0;
        if ((call.duration || 0) >= 1800) agentDailyMap[call.userId][day].longCalls++;
      }
    }

    // All dates in the range for consistent x-axis
    const allDates = Object.values(dailyMap).map((d) => d.date).sort();

    const agentActivity = Object.entries(agentMap)
      .map(([userId, data]) => ({
        agentName: userMap[userId] || 'Unknown',
        callsHandled: data.callsHandled,
        totalTalkTime: data.totalTalkTime,
        avgCallDuration: data.callsHandled > 0 ? Math.round(data.totalTalkTime / data.callsHandled) : 0,
        longCalls: data.longCalls,
      }))
      .sort((a, b) => b.callsHandled - a.callsHandled);

    // Daily per-agent data for line charts
    const agentDaily = Object.entries(agentDailyMap).map(([userId, days]) => ({
      agentName: userMap[userId] || 'Unknown',
      daily: allDates.map((date) => ({
        date,
        calls: days[date]?.calls || 0,
        talkTime: days[date]?.talkTime || 0,
        longCalls: days[date]?.longCalls || 0,
      })),
    })).sort((a, b) => {
      const totalA = a.daily.reduce((s, d) => s + d.calls, 0);
      const totalB = b.daily.reduce((s, d) => s + d.calls, 0);
      return totalB - totalA;
    });

    // --- Team Average (always team-wide, even when filtered to one user) ---
    let teamAgentMap = agentMap;
    let teamAgentDailyMap = agentDailyMap;
    if (filteredUserId) {
      teamAgentMap = {};
      teamAgentDailyMap = {};
      for (const call of teamCalls) {
        if (call.status !== 'COMPLETE') continue;
        if (!isSaneDuration(call.duration)) continue;
        if (!call.userId || supervisorIds.has(call.userId)) continue;
        if (!teamAgentMap[call.userId]) teamAgentMap[call.userId] = { callsHandled: 0, totalTalkTime: 0, longCalls: 0 };
        teamAgentMap[call.userId].callsHandled++;
        teamAgentMap[call.userId].totalTalkTime += call.duration || 0;
        if ((call.duration || 0) >= 1800) teamAgentMap[call.userId].longCalls++;
        const day = call.startTime ? call.startTime.slice(0, 10) : null;
        if (day) {
          if (!teamAgentDailyMap[call.userId]) teamAgentDailyMap[call.userId] = {};
          if (!teamAgentDailyMap[call.userId][day]) teamAgentDailyMap[call.userId][day] = { calls: 0, talkTime: 0, longCalls: 0 };
          teamAgentDailyMap[call.userId][day].calls++;
          teamAgentDailyMap[call.userId][day].talkTime += call.duration || 0;
          if ((call.duration || 0) >= 1800) teamAgentDailyMap[call.userId][day].longCalls++;
        }
      }
    }

    const teamAgentCount = Object.keys(teamAgentMap).length;
    const teamAvgDaily = allDates.map((date) => {
      let sumCalls = 0;
      let sumTalk = 0;
      let sumLong = 0;
      let activeAgents = 0;
      for (const uid of Object.keys(teamAgentDailyMap)) {
        const day = teamAgentDailyMap[uid][date];
        if (!day || !day.calls) continue;
        sumCalls += day.calls;
        sumTalk += day.talkTime || 0;
        sumLong += day.longCalls || 0;
        activeAgents++;
      }
      return {
        date,
        calls: activeAgents ? sumCalls / activeAgents : 0,
        talkTime: activeAgents ? sumTalk / activeAgents : 0,
        longCalls: activeAgents ? sumLong / activeAgents : 0,
      };
    });
    const teamSumCalls = Object.values(teamAgentMap).reduce((s, a) => s + a.callsHandled, 0);
    const teamSumTalk = Object.values(teamAgentMap).reduce((s, a) => s + a.totalTalkTime, 0);
    const teamSumLong = Object.values(teamAgentMap).reduce((s, a) => s + (a.longCalls || 0), 0);
    const teamAvgOverall = {
      calls: teamAgentCount ? teamSumCalls / teamAgentCount : 0,
      talkTime: teamAgentCount ? teamSumTalk / teamAgentCount : 0,
      longCalls: teamAgentCount ? teamSumLong / teamAgentCount : 0,
    };

    // --- Team-wide Duration metrics (for per-card comparison when a user is filtered) ---
    let teamDuration = duration;
    if (filteredUserId) {
      const teamAnswered = teamCalls.filter((c) => c.status === 'COMPLETE' && isSaneDuration(c.duration));
      const teamCallDurations = teamAnswered.map((c) => c.duration);
      const teamQueueTimes = teamCalls.map((c) => c.queueDuration).filter(isSaneDuration);
      const teamLongCallsTotal = teamCallDurations.filter((d) => d >= 1800).length;
      teamDuration = {
        avgCallDuration: avg(teamCallDurations),
        longestCallDuration: teamCallDurations.length ? Math.max(...teamCallDurations) : 0,
        avgQueueTime: avg(teamQueueTimes),
        longestQueueTime: teamQueueTimes.length ? Math.max(...teamQueueTimes) : 0,
        // Per-agent average so it's apples-to-apples with a single agent's count
        longCalls: teamAgentCount ? Math.round((teamLongCallsTotal / teamAgentCount) * 10) / 10 : 0,
      };
    }

    // --- Salesforce Cases ---
    let cases = { stats: { total: 0, open: 0, closed: 0 }, records: [] };
    try {
      await sfdcConn.authorize({ grant_type: 'client_credentials' });

      // Build SOQL query for cases in the date range
      const sfdcStart = start.toISOString().split('T')[0] + 'T00:00:00Z';
      const sfdcEnd = rangeEnd.toISOString().split('T')[0] + 'T00:00:00Z';

      // If filtering by user, get their sfdcId to filter by OwnerId
      let ownerFilter = '';
      if (filteredUserId) {
        const selectedUser = users.find((u) => u.id === filteredUserId);
        if (selectedUser?.sfdcId) {
          ownerFilter = `AND OwnerId = '${selectedUser.sfdcId}' `;
        }
      }

      const soql = `SELECT Id, CaseNumber, Subject, Status, CreatedDate, ClosedDate,
                     Owner.Name, Account.Name, First_Name__c, Last_Name__c
                     FROM Case
                     WHERE CreatedDate >= ${sfdcStart} AND CreatedDate < ${sfdcEnd}
                     AND Owner.Name != 'Support Queue'
                     ${ownerFilter}
                     ORDER BY CreatedDate DESC
                     LIMIT 2000`;

      const result = await sfdcConn.query(soql);
      const records = result.records || [];

      const open = records.filter((r) => r.Status !== 'Closed').length;
      cases = {
        stats: { total: records.length, open, closed: records.length - open },
        records: records.map((r) => ({
          id: r.Id,
          caseNumber: r.CaseNumber,
          subject: r.Subject,
          status: r.Status,
          createdDate: r.CreatedDate,
          closedDate: r.ClosedDate,
          ownerName: r.Owner?.Name || '--',
          accountName: r.Account?.Name || '--',
          techName: [r.First_Name__c, r.Last_Name__c].filter(Boolean).join(' ') || '--',
        })),
      };
    } catch (sfdcError) {
      // Non-fatal: return empty cases if Salesforce is unavailable
      console.error('Salesforce case query failed:', sfdcError.message);
    }

    res.json({
      callVolumes: { daily, totals },
      duration,
      teamDuration,
      flaggedCalls,
      agentActivity,
      agentDaily,
      allDates,
      teamAvgDaily,
      teamAvgOverall,
      cases,
      userList,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate reports' });
  }
};

module.exports = { getReports };
