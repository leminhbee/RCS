const ava = require('../AVA');
const atp = require('../ATP');
const { createStatusLog, formatError } = require('../helpers/log_schema');
const moment = require('moment');
const { isInWrapUp, clearWrapUp, startWrapUp } = require('../helpers/wrapup_timers');

const handleRequest = async (req, res) => {
  const { messageId, logger } = req;
  const body = req.body;
  const user = body.alulaUser;

  try {
    // Skip Slack updates for supervisors, but persist status for dashboard
    if (user.supervisor) {
      atp.users.update(user.id, {
        currentStatus: body.event_aux_type,
        statusSince: new Date(),
      });

      logger.info(
        createStatusLog({
          operation: 'update',
          messageId,
          status: body.event_aux_type,
          previousStatus: body.prev_aux_state,
          data: {
            message: 'Supervisor status change - Slack update skipped',
          },
        })
      );
      return;
    }

    // Skip if no user found
    if (!user) {
      return;
    }
    // Define a map for status updates based on event_aux_type
    const statusMap = {
      AVAILABLE: {
        statusText: `Available @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':large_green_circle:',
      },
      LUNCH: {
        statusText: `Lunch @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':hamburger:',
      },
      'ON-BREAK': {
        statusText: `Break @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':clock:',
      },
      TRAINING: {
        statusText: `Training @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':question-block:',
      },
      OUTBOUND: {
        statusText: `OUTBOUND @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':phone:',
      },
      Meeting: {
        statusText: `Meeeting @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':spiral_calendar_pad:',
      },
      'Follow-Up': {
        statusText: `Follow Up @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':pencil:',
      },
      'Email Support': {
        statusText: `Email Support @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':email:',
      },
      'Bathroom Break': {
        statusText: `Bathroom @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':toilet:',
      },
      ENGAGED: {
        statusText: `On Call @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':telephone_receiver:',
      },
      'RNA-STATE': {
        statusText: `RNA @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':no_mobile_phones:',
      },
      RINGING: {
        statusText: `Ringing @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':bell:',
      },
      'LOGOUT': {
        statusText: '',
        statusEmoji: '',
      },
      'OFF-LINE': {
        statusText: '',
        statusEmoji: '',
      },
      'LOGIN': {
        statusText: ``,
        statusEmoji: '',
      },
    };

    if (body.event_aux_type === 'TRANSITION' || (body.event_aux_type === 'ENGAGED' && body.prev_aux_state === 'OUTBOUND')) {
      return;
    }

    // ENGAGED -> AVAILABLE means a call just ended — start 2 minute wrap-up
    if (body.event_aux_type === 'AVAILABLE' && body.prev_state === 'ENGAGED') {
      startWrapUp(user, logger);
      logger.info(
        createStatusLog({
          operation: 'update',
          messageId,
          userId: user.id,
          status: 'WRAP-UP',
          previousStatus: 'ENGAGED',
          data: { message: 'Call ended — agent placed in WRAP-UP status' },
        })
      );
      return;
    }

    // If agent is in wrap-up and changes to a non-AVAILABLE status, clear the timer
    if (isInWrapUp(user.id)) {
      clearWrapUp(user.id);
      logger.info(
        createStatusLog({
          operation: 'update',
          messageId,
          userId: user.id,
          status: body.event_aux_type,
          data: { message: 'WRAP-UP timer cleared — agent changed status manually' },
        })
      );
    }

    if (statusMap[body.event_aux_type]) {
      ava.status.update({
        slackId: user.slackId,
        ...statusMap[body.event_aux_type],
      });

      atp.users.update(user.id, {
        currentStatus: body.event_aux_type,
        statusSince: new Date(),
      });

      logger.info(
        createStatusLog({
          operation: 'update',
          messageId,
          userId: user.id,
          slackId: user.slackId,
          status: body.event_aux_type,
          previousStatus: body.prev_aux_state,
          data: {
            statusText: statusMap[body.event_aux_type].statusText,
            statusEmoji: statusMap[body.event_aux_type].statusEmoji,
            userName: user.nameFirst,
          },
        })
      );
    } else {
      throw new Error('Unknown status set');
    }
  } catch (error) {
    logger.error({
      ...createStatusLog({
        operation: 'update',
        messageId,
        userId: user?.id,
        slackId: user?.slackId,
        status: body.event_aux_type,
        previousStatus: body.prev_aux_state,
      }),
      ...formatError(error),
    });
  }
};

module.exports = handleRequest;
