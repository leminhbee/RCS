const atp = require('../ATP');

const OFFLINE_STATUSES = [null, 'LOGOUT', 'OFF-LINE'];
const SUPERVISOR_VISIBLE_STATUSES = ['AVAILABLE', 'ENGAGED'];

const maskNumber = (number) => {
  if (!number) return null;
  return 'X'.repeat(number.length - 4) + number.slice(-4);
};

const getData = async (req, res) => {
  try {
    const [users, calls] = await Promise.all([
      atp.users.fetchAll({ callsActive: true }),
      atp.calls.fetchAll({ status: ['QUEUED', 'CALLBACK_REQUESTED', 'RINGING', 'ACTIVE'] }),
    ]);

    // Build a map of active calls keyed by userId
    const activeCallsByUser = {};
    for (const call of calls) {
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

    // Queue: QUEUED and CALLBACK_REQUESTED calls, ordered by entry time
    const queue = calls
      .filter((c) => c.status === 'QUEUED' || c.status === 'CALLBACK_REQUESTED')
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .map((c) => ({
        callerNumber: maskNumber(c.callerNumber),
        callerName: c.callerName,
        companyName: c.companyName,
        startTime: c.startTime,
        callbackRequested: c.status === 'CALLBACK_REQUESTED',
      }));

    res.json({ agents, queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

module.exports = {
  getData,
};
