const ava = require('../AVA');
const atp = require('../ATP');
const moment = require('moment');

const WRAPUP_DURATION = 2 * 60 * 1000; // 2 minutes in ms

// In-memory map of userId -> timerId (ATP statusSince is the source of truth)
const activeTimers = new Map();

function setAvailable(user) {
  ava.status.update({
    slackId: user.slackId,
    statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
    statusEmoji: ':large_green_circle:',
  });
  atp.users.update(user.id, {
    currentStatus: 'AVAILABLE',
    statusSince: new Date(),
  });
}

function startWrapUp(user, logger, delay = WRAPUP_DURATION) {
  clearWrapUp(user.id);

  ava.status.update({
    slackId: user.slackId,
    statusText: `Wrap Up @ ${moment(Date.now()).format('hh:mm a')}`,
    statusEmoji: ':hourglass_flowing_sand:',
  });
  atp.users.update(user.id, {
    currentStatus: 'WRAP-UP',
    statusSince: new Date(),
  });

  const timer = setTimeout(() => {
    setAvailable(user);
    activeTimers.delete(user.id);
    logger.info({ event: 'WRAPUP_EXPIRED', userId: user.id, message: 'Wrap-up expired, agent set to AVAILABLE' });
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
      const timer = setTimeout(() => {
        setAvailable(user);
        activeTimers.delete(user.id);
        logger.info({ event: 'WRAPUP_RECOVERY_EXPIRED', userId: user.id, message: 'Recovered wrap-up expired, agent set to AVAILABLE' });
      }, remaining);
      activeTimers.set(user.id, timer);

      logger.info({ event: 'WRAPUP_RECOVERED', userId: user.id, message: `Wrap-up timer recovered (${Math.round(remaining / 1000)}s remaining)` });
    } else {
      // Wrap-up already expired during downtime
      setAvailable(user);
      logger.info({ event: 'WRAPUP_RECOVERY_EXPIRED', userId: user.id, message: 'Wrap-up had expired during downtime, agent set to AVAILABLE' });
    }
  }
}

module.exports = {
  startWrapUp,
  clearWrapUp,
  isInWrapUp,
  recoverWrapUps,
};
