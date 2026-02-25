const ava = require('../AVA');
const atp = require('../ATP');
const { sfdcConn } = require('../config/sfdc');
const { createQueueLog } = require('./log_schema');

const CALLBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes in ms

// In-memory map of callRecordId -> timerId
const activeTimers = new Map();

async function startCallbackTimer(callRecord, logger, delay = CALLBACK_TIMEOUT) {
  if (activeTimers.has(callRecord.id)) return;

  const timer = setTimeout(async () => {
    try {
      await atp.calls.update(callRecord.id, {
        status: 'CALLBACK_FAILED',
        endTime: new Date(),
      });

      if (callRecord.salesforceCaseId) {
        await sfdcConn.authorize({ grant_type: 'client_credentials' });
        await sfdcConn.sobject('Case').update({
          Id: callRecord.salesforceCaseId,
          Status: 'Closed',
        });
      }

      await ava.notify.callbackFailed(callRecord.callerNumber, callRecord.callerName, callRecord.companyName);

      logger.info(
        createQueueLog({
          operation: 'callback',
          subOperation: 'CALLBACK_EXPIRED',
          callerNumber: callRecord.callerNumber,
          callId: callRecord.callId,
          callRecordId: callRecord.id,
          caseId: callRecord.salesforceCaseId,
          data: { message: 'Callback timer expired, marked as CALLBACK_FAILED' },
        })
      );

      const { broadcast } = require('./websocket');
      await broadcast();
    } catch (error) {
      logger.error({
        ...createQueueLog({
          operation: 'callback',
          subOperation: 'CALLBACK_EXPIRE_ERROR',
          callerNumber: callRecord.callerNumber,
          callId: callRecord.callId,
          callRecordId: callRecord.id,
        }),
        error: error.message,
        stack: error.stack,
      });
    } finally {
      activeTimers.delete(callRecord.id);
    }
  }, delay);

  activeTimers.set(callRecord.id, timer);
}

function clearCallbackTimer(callRecordId) {
  const timer = activeTimers.get(callRecordId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(callRecordId);
  }
}

function hasCallbackTimer(callRecordId) {
  return activeTimers.has(callRecordId);
}

async function checkCallbackQueue(logger) {
  const queue = await atp.calls.fetchAll({ status: ['QUEUED', 'CALLBACK_REQUESTED'] });
  if (!queue || queue.length === 0) return;

  const sorted = queue.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const nextInQueue = sorted[0];

  if (nextInQueue.status === 'CALLBACK_REQUESTED' && !hasCallbackTimer(nextInQueue.id)) {
    startCallbackTimer(nextInQueue, logger);
    logger.info(
      createQueueLog({
        operation: 'callback',
        subOperation: 'CALLBACK_TIMER_STARTED',
        callerNumber: nextInQueue.callerNumber,
        callId: nextInQueue.callId,
        callRecordId: nextInQueue.id,
        data: { message: 'Callback timer started (agent available, callback is next in queue)' },
      })
    );
  }
}

async function recoverCallbackTimers(logger) {
  const users = await atp.users.fetchAll({ callsActive: true });
  const hasAvailableAgent = users.some(
    (u) => u.currentStatus === 'AVAILABLE' && !u.supervisor
  );

  if (!hasAvailableAgent) return;

  await checkCallbackQueue(logger);
}

module.exports = {
  startCallbackTimer,
  clearCallbackTimer,
  hasCallbackTimer,
  checkCallbackQueue,
  recoverCallbackTimers,
};
