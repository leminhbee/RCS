const ava = require('../AVA');
const atp = require('../ATP');
const moment = require('moment');
const { broadcast } = require('./websocket');
const { createStatusLog } = require('./log_schema');
const { checkCallbackQueue } = require('./callback_timers');

const WRAPUP_DURATION = 2 * 60 * 1000; // 2 minutes in ms

// In-memory map of userId -> timerId (ATP statusSince is the source of truth)
const activeTimers = new Map();

async function setAvailable(user, logger) {
  await ava.status.update({
    slackId: user.slackId,
    statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
    statusEmoji: ':large_green_circle:',
  });
  await atp.users.update(user.id, {
    currentStatus: 'AVAILABLE',
    statusSince: new Date(),
  });
  await broadcast();

  // Agent is now available — check if the next queued call is a callback
  if (logger) {
    await checkCallbackQueue(logger);
  }
}

async function startWrapUp(user, logger, delay = WRAPUP_DURATION) {
  clearWrapUp(user.id);

  await ava.status.update({
    slackId: user.slackId,
    statusText: `Wrap Up @ ${moment(Date.now()).format('hh:mm a')}`,
    statusEmoji: ':hourglass_flowing_sand:',
  });
  await atp.users.update(user.id, {
    currentStatus: 'WRAP-UP',
    statusSince: new Date(),
  });

  const timer = setTimeout(async () => {
    try {
      await setAvailable(user, logger);
      logger.info(
        createStatusLog({
          operation: 'update',
          userId: user.id,
          slackId: user.slackId,
          status: 'AVAILABLE',
          previousStatus: 'WRAP-UP',
          data: {
            statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
            statusEmoji: ':large_green_circle:',
            userName: user.nameFirst,
          },
        })
      );
    } finally {
      activeTimers.delete(user.id);
    }
  }, delay);

  activeTimers.set(user.id, timer);
}

function clearWrapUp(userId) {
  const timer = activeTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(userId);
  }
}

function isInWrapUp(userId) {
  return activeTimers.has(userId);
}

async function recoverWrapUps(logger) {
  const wrapUpUsers = await atp.users.fetchAll({ currentStatus: 'WRAP-UP' });

  for (const user of wrapUpUsers) {
    const elapsed = Date.now() - new Date(user.statusSince).getTime();
    const remaining = WRAPUP_DURATION - elapsed;

    if (remaining > 0) {
      // Restart timer for remaining duration (skip setting AVA/ATP since already in WRAP-UP)
      const timer = setTimeout(async () => {
        try {
          await setAvailable(user, logger);
          logger.info(
            createStatusLog({
              operation: 'update',
              userId: user.id,
              slackId: user.slackId,
              status: 'AVAILABLE',
              previousStatus: 'WRAP-UP',
              data: {
                statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
                statusEmoji: ':large_green_circle:',
                userName: user.nameFirst,
                message: 'Recovered wrap-up expired, agent set to AVAILABLE',
              },
            })
          );
        } finally {
          activeTimers.delete(user.id);
        }
      }, remaining);
      activeTimers.set(user.id, timer);

      logger.info(
        createStatusLog({
          operation: 'update',
          userId: user.id,
          slackId: user.slackId,
          status: 'WRAP-UP',
          data: {
            userName: user.nameFirst,
            message: `Wrap-up timer recovered (${Math.round(remaining / 1000)}s remaining)`,
          },
        })
      );
    } else {
      // Wrap-up already expired during downtime
      await setAvailable(user, logger);
      logger.info(
        createStatusLog({
          operation: 'update',
          userId: user.id,
          slackId: user.slackId,
          status: 'AVAILABLE',
          previousStatus: 'WRAP-UP',
          data: {
            statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
            statusEmoji: ':large_green_circle:',
            userName: user.nameFirst,
            message: 'Wrap-up had expired during downtime, agent set to AVAILABLE',
          },
        })
      );
    }
  }
}

module.exports = {
  startWrapUp,
  clearWrapUp,
  isInWrapUp,
  recoverWrapUps,
};
