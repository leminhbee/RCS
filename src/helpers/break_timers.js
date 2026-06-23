const ava = require('../AVA');
const atp = require('../ATP');
const { createStatusLog, formatError } = require('./log_schema');
const { getBufferSeconds } = require('./breakLateBuffer');

// Cap (max allowed duration) per break type, in seconds.
// null means no cap / no late tracking.
const CAPS = {
  Lunch: 60 * 60,
  Break: 15 * 60,
  Bathroom: null,
};

// Fallback warning offsets (seconds before cap) when the user has no
// preferredLunchTimer / preferredBreakTimer set on their ATP record.
const DEFAULT_WARNING = {
  Lunch: 10 * 60,
  Break: 2 * 60,
};

// userId -> { warnTimer, lateTimer, breakRecordId, type }
const activeTimers = new Map();

function clearBreakTimers(userId) {
  const entry = activeTimers.get(userId);
  if (!entry) return;
  if (entry.warnTimer) clearTimeout(entry.warnTimer);
  if (entry.lateTimer) clearTimeout(entry.lateTimer);
  if (entry.lateNotifyTimer) clearTimeout(entry.lateNotifyTimer);
  activeTimers.delete(userId);
}

function getWarningOffset(user, type) {
  const cap = CAPS[type];
  if (cap == null) return null;
  const raw = type === 'Lunch'
    ? user.preferredLunchTimer
    : user.preferredBreakTimer;
  const offset = raw ?? DEFAULT_WARNING[type];
  return Math.max(0, Math.min(offset, cap));
}

// Flip `late: true` on the record at the cap. No Slack notification yet —
// that's deferred by the configured buffer (see fireLateNotify).
async function fireLateFlip(user, breakRecordId, logger) {
  try {
    await atp.breaks.update(breakRecordId, { late: true });
  } catch (error) {
    logger.error({
      ...createStatusLog({
        operation: 'break_late_flip',
        userId: user.id,
        data: { breakRecordId, message: 'Failed to flip late=true on break record' },
      }),
      ...formatError(error),
    });
    return;
  }
  logger.info(
    createStatusLog({
      operation: 'break_late_flip',
      userId: user.id,
      slackId: user.slackId,
      data: { breakRecordId, userName: user.nameFirst },
    })
  );
}

// Fire late notifications (admin + agent DM via AVA) after the buffer has
// elapsed past the cap. Does not touch the record's `late` flag — that was
// already set by fireLateFlip at the cap.
async function fireLateNotify(user, breakRecordId, logger) {
  try {
    await ava.notify.late(user.slackId, user.nameFirst, 0);
  } catch (error) {
    logger.error({
      ...createStatusLog({
        operation: 'break_late_notify',
        userId: user.id,
        slackId: user.slackId,
        data: { breakRecordId, message: 'Failed to send late notification' },
      }),
      ...formatError(error),
    });
    return;
  }
  logger.info(
    createStatusLog({
      operation: 'break_late_notify',
      userId: user.id,
      slackId: user.slackId,
      data: { breakRecordId, userName: user.nameFirst },
    })
  );
}

async function fireWarn(user, warningOffset, logger) {
  try {
    await ava.notify.breakEnding(user.slackId, warningOffset);
  } catch (error) {
    logger.error({
      ...createStatusLog({
        operation: 'break_warn',
        userId: user.id,
        slackId: user.slackId,
        data: { warningOffset, message: 'Failed to send breakEnding notification' },
      }),
      ...formatError(error),
    });
  }
  logger.info(
    createStatusLog({
      operation: 'break_warn',
      userId: user.id,
      slackId: user.slackId,
      data: { warningOffset, userName: user.nameFirst },
    })
  );
}

function scheduleTimers(user, breakRecord, logger, { elapsedSeconds = 0, bufferSeconds = 0 } = {}) {
  const { type, id: breakRecordId } = breakRecord;
  const cap = CAPS[type];
  if (cap == null) return; // Bathroom — no timers

  const warningOffset = getWarningOffset(user, type);
  const warnAt = cap - warningOffset;
  const lateAt = cap;
  const lateNotifyAt = cap + bufferSeconds;

  const entry = { warnTimer: null, lateTimer: null, lateNotifyTimer: null, breakRecordId, type };

  const warnDelay = (warnAt - elapsedSeconds) * 1000;
  if (warnDelay > 0) {
    entry.warnTimer = setTimeout(() => {
      fireWarn(user, warningOffset, logger).finally(() => {
        const current = activeTimers.get(user.id);
        if (current) current.warnTimer = null;
      });
    }, warnDelay);
  }

  const lateDelay = (lateAt - elapsedSeconds) * 1000;
  if (lateDelay > 0) {
    entry.lateTimer = setTimeout(() => {
      fireLateFlip(user, breakRecordId, logger).finally(() => {
        const current = activeTimers.get(user.id);
        if (current) current.lateTimer = null;
      });
    }, lateDelay);
  }

  const notifyDelay = (lateNotifyAt - elapsedSeconds) * 1000;
  if (notifyDelay > 0) {
    entry.lateNotifyTimer = setTimeout(() => {
      fireLateNotify(user, breakRecordId, logger).finally(() => {
        const current = activeTimers.get(user.id);
        if (current) current.lateNotifyTimer = null;
      });
    }, notifyDelay);
  }

  activeTimers.set(user.id, entry);
}

async function startBreak(user, breakType, logger) {
  clearBreakTimers(user.id);

  let breakRecord;
  try {
    breakRecord = await atp.breaks.create({
      userId: user.id,
      type: breakType,
      startTime: new Date(),
    });
  } catch (error) {
    logger.error({
      ...createStatusLog({
        operation: 'break_start',
        userId: user.id,
        slackId: user.slackId,
        data: { type: breakType, message: 'Failed to create break record' },
      }),
      ...formatError(error),
    });
    return;
  }

  const bufferSeconds = await getBufferSeconds();
  scheduleTimers(user, breakRecord, logger, { bufferSeconds });

  logger.info(
    createStatusLog({
      operation: 'break_start',
      userId: user.id,
      slackId: user.slackId,
      data: {
        type: breakType,
        breakRecordId: breakRecord.id,
        bufferSeconds,
        userName: user.nameFirst,
      },
    })
  );
}

async function endBreak(user, logger) {
  const inMemory = activeTimers.get(user.id);
  clearBreakTimers(user.id);

  let breakRecord = null;
  if (inMemory?.breakRecordId) {
    try {
      breakRecord = await atp.breaks.fetchOne(inMemory.breakRecordId);
    } catch (error) {
      logger.warn({
        ...createStatusLog({
          operation: 'break_end',
          userId: user.id,
          data: {
            breakRecordId: inMemory.breakRecordId,
            message: 'Failed to fetch cached break record; falling back to filter lookup',
          },
        }),
        ...formatError(error),
      });
    }
  }
  if (!breakRecord) {
    try {
      breakRecord = await atp.breaks.fetchOne({ userId: user.id, endTime: null });
    } catch (error) {
      logger.error({
        ...createStatusLog({
          operation: 'break_end',
          userId: user.id,
          data: { message: 'Failed to find open break record' },
        }),
        ...formatError(error),
      });
      return;
    }
  }
  if (!breakRecord) {
    // No open record — expected when breaksEnabled was false at the time of startBreak,
    // or when this status transition isn't actually leaving a break. Silent return.
    return;
  }

  const endTime = new Date();
  const startTime = new Date(breakRecord.startTime);
  const duration = Math.max(0, Math.round((endTime - startTime) / 1000));
  const cap = CAPS[breakRecord.type];
  const lateBy = cap != null ? Math.max(0, duration - cap) : 0;
  const late = lateBy > 0 || breakRecord.late === true;

  try {
    await atp.breaks.update(breakRecord.id, {
      endTime,
      duration,
      lateBy,
      late,
    });
  } catch (error) {
    logger.error({
      ...createStatusLog({
        operation: 'break_end',
        userId: user.id,
        data: { breakRecordId: breakRecord.id, message: 'Failed to update break record on end' },
      }),
      ...formatError(error),
    });
    return;
  }

  logger.info(
    createStatusLog({
      operation: 'break_end',
      userId: user.id,
      slackId: user.slackId,
      data: {
        type: breakRecord.type,
        breakRecordId: breakRecord.id,
        duration,
        lateBy,
        late,
        userName: user.nameFirst,
      },
    })
  );
}

async function recoverBreakTimers(logger) {
  let openBreaks = [];
  try {
    openBreaks = await atp.breaks.fetchAll({ endTime: null });
  } catch (error) {
    logger.error({
      ...createStatusLog({ operation: 'break_recovery', data: { message: 'Failed to fetch open breaks' } }),
      ...formatError(error),
    });
    return;
  }

  const bufferSeconds = await getBufferSeconds();

  for (const breakRecord of openBreaks) {
    if (breakRecord.type === 'Bathroom') continue; // nothing to schedule

    let user;
    try {
      user = await atp.users.fetchOne(breakRecord.userId);
    } catch (error) {
      logger.warn({
        ...createStatusLog({
          operation: 'break_recovery',
          userId: breakRecord.userId,
          data: { breakRecordId: breakRecord.id, message: 'Failed to fetch user for open break' },
        }),
        ...formatError(error),
      });
      continue;
    }
    if (!user) continue;
    if (!user.breaksEnabled) continue;

    const cap = CAPS[breakRecord.type];
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(breakRecord.startTime).getTime()) / 1000));

    // Catch up on missed events. Schedule the rest via scheduleTimers (its
    // delay > 0 guards will skip whatever already passed).
    if (cap != null && elapsedSeconds >= cap && !breakRecord.late) {
      await fireLateFlip(user, breakRecord.id, logger);
    }
    // If past cap+buffer, fire notify once. Per the accepted recovery design,
    // this may double-notify in the narrow case where the original notify ran
    // and the server crashed within seconds.
    if (cap != null && elapsedSeconds >= cap + bufferSeconds) {
      await fireLateNotify(user, breakRecord.id, logger);
    }

    scheduleTimers(user, breakRecord, logger, { elapsedSeconds, bufferSeconds });

    logger.info(
      createStatusLog({
        operation: 'break_recovery',
        userId: user.id,
        slackId: user.slackId,
        data: {
          type: breakRecord.type,
          breakRecordId: breakRecord.id,
          elapsedSeconds,
          bufferSeconds,
          userName: user.nameFirst,
        },
      })
    );
  }
}

module.exports = {
  startBreak,
  endBreak,
  clearBreakTimers,
  recoverBreakTimers,
};
