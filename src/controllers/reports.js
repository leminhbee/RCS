const atp = require('../ATP');
const { sfdcConn } = require('../config/sfdc');

const MAX_RANGE_DAYS = 93;

const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

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
    if (req.query.userId) callFilter.userId = req.query.userId;

    const [allCalls, users] = await Promise.all([
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

    const calls = allCalls;

    // Build user list for dropdown (only active agents)
    const userList = users
      .filter((u) => u.callsActive)
      .map((u) => ({ id: u.id, name: `${u.nameFirst} ${u.nameLast}`.trim() }))
      .sort((a, b) => a.name.localeCompare(b.name));

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
    const answered = calls.filter((c) => c.status === 'COMPLETE');
    const callDurations = answered.map((c) => c.duration).filter((d) => d != null);
    const queueTimes = calls.map((c) => c.queueDuration).filter((d) => d != null);

    const duration = {
      avgCallDuration: avg(callDurations),
      longestCallDuration: callDurations.length ? Math.max(...callDurations) : 0,
      avgQueueTime: avg(queueTimes),
      longestQueueTime: queueTimes.length ? Math.max(...queueTimes) : 0,
    };

    // --- Agent Activity ---
    const agentMap = {};
    const agentDailyMap = {}; // { userId: { date: { calls, talkTime } } }
    for (const call of answered) {
      if (!call.userId) continue;
      if (supervisorIds.has(call.userId)) continue;
      if (!agentMap[call.userId]) {
        agentMap[call.userId] = { callsHandled: 0, totalTalkTime: 0 };
      }
      const a = agentMap[call.userId];
      a.callsHandled++;
      a.totalTalkTime += call.duration || 0;

      // Daily breakdown per agent
      const day = call.startTime ? call.startTime.slice(0, 10) : null;
      if (day) {
        if (!agentDailyMap[call.userId]) agentDailyMap[call.userId] = {};
        if (!agentDailyMap[call.userId][day]) agentDailyMap[call.userId][day] = { calls: 0, talkTime: 0 };
        agentDailyMap[call.userId][day].calls++;
        agentDailyMap[call.userId][day].talkTime += call.duration || 0;
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
      }))
      .sort((a, b) => b.callsHandled - a.callsHandled);

    // Daily per-agent data for line charts
    const agentDaily = Object.entries(agentDailyMap).map(([userId, days]) => ({
      agentName: userMap[userId] || 'Unknown',
      daily: allDates.map((date) => ({
        date,
        calls: days[date]?.calls || 0,
        talkTime: days[date]?.talkTime || 0,
      })),
    })).sort((a, b) => {
      const totalA = a.daily.reduce((s, d) => s + d.calls, 0);
      const totalB = b.daily.reduce((s, d) => s + d.calls, 0);
      return totalB - totalA;
    });

    // --- Salesforce Cases ---
    let cases = { stats: { total: 0, open: 0, closed: 0 }, records: [] };
    try {
      await sfdcConn.authorize({ grant_type: 'client_credentials' });

      // Build SOQL query for cases in the date range
      const sfdcStart = start.toISOString().split('T')[0] + 'T00:00:00Z';
      const sfdcEnd = rangeEnd.toISOString().split('T')[0] + 'T00:00:00Z';

      // If filtering by user, get their sfdcId to filter by OwnerId
      let ownerFilter = '';
      if (req.query.userId) {
        const selectedUser = users.find((u) => u.id === req.query.userId);
        if (selectedUser?.sfdcId) {
          ownerFilter = `AND OwnerId = '${selectedUser.sfdcId}' `;
        }
      }

      const soql = `SELECT Id, CaseNumber, Subject, Status, CreatedDate, ClosedDate,
                     Owner.Name, Account.Name, First_Name__c, Last_Name__c
                     FROM Case
                     WHERE CreatedDate >= ${sfdcStart} AND CreatedDate < ${sfdcEnd}
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
      agentActivity,
      agentDaily,
      allDates,
      cases,
      userList,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate reports' });
  }
};

module.exports = { getReports };
