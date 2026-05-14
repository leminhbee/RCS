const ava = require('../AVA');
const atp = require('../ATP');
const { createStatusLog, formatError } = require('../helpers/log_schema');
const moment = require('moment');
const { isInWrapUp, clearWrapUp, startWrapUp } = require('../helpers/wrapup_timers');
const { checkCallbackQueue } = require('../helpers/callback_timers');

const handleRequest = async (req, res) => {
  const { messageId, logger } = req;
  const body = req.body;
  const user = body.alulaUser;

  try {
    // Skip Slack updates for supervisors, but persist status for dashboard
    if (user.supervisor) {
      // If supervisor goes ENGAGED with a call_id that belongs to another agent,
      // they're monitoring (silent listen) — skip the status update so they don't appear as on a call
      if (body.event_aux_type === 'ENGAGED' && req.callRecord && req.callRecord.userId && req.callRecord.userId !== user.id) {
        logger.info(
          createStatusLog({
            operation: 'update',
            messageId,
            status: body.event_aux_type,
            data: {
              message: 'Supervisor monitoring detected - status update skipped',
              monitoredCallId: req.callRecord.callId,
              monitoredUserId: req.callRecord.userId,
            },
          })
        );
        return;
      }

      await atp.users.update(user.id, {
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

    if (body.event_aux_type === 'TRANSITION') {
      return;
    }

    // RNA-STATE means the agent didn't answer a ringing call.
    // Clear the userId from any RINGING call assigned to them so the
    // dashboard stops showing that call next to the agent while RC
    // re-routes it to the next available agent.
    if (body.event_aux_type === 'RNA-STATE') {
      try {
        const ringingCall = await atp.calls.fetchOne({ status: 'RINGING', userId: user.id });
        if (ringingCall) {
          await atp.calls.update(ringingCall.id, { userId: null });
          logger.info(
            createStatusLog({
              operation: 'update',
              messageId,
              userId: user.id,
              status: 'RNA-STATE',
              data: {
                message: 'Cleared userId from RINGING call after RNA',
                callRecordId: ringingCall.id,
              },
            })
          );
        }
      } catch (err) {
        logger.error(
          createStatusLog({
            operation: 'update',
            messageId,
            userId: user.id,
            status: 'RNA-STATE',
            data: { message: 'Failed to clear RINGING call after RNA', error: err.message },
          })
        );
      }
    }

    // While in OUTBOUND, ignore RC's automatic call-state transitions
    // (so the OUTBOUND badge stays put during the call), but let manual
    // aux-state changes through so agents can exit OUTBOUND directly to
    // ON-BREAK, LUNCH, etc. without getting stuck.
    const AUTO_TRANSITIONS_DURING_OUTBOUND = new Set(['ENGAGED', 'WRAP-UP', 'RINGING']);
    if (user.currentStatus === 'OUTBOUND' && AUTO_TRANSITIONS_DURING_OUTBOUND.has(body.event_aux_type)) {
      return;
    }

    // ENGAGED -> AVAILABLE means a call just ended — start 2 minute wrap-up
    // Skip wrap-up for outbound calls (no wrap-up needed)
    if (body.event_aux_type === 'AVAILABLE' && body.prev_state === 'ENGAGED') {
      if (user.currentStatus === 'OUTBOUND') {
        // Outbound call ended — fall through to set AVAILABLE normally, no wrap-up
      } else {
        // Fallback: if RingCentral never delivered /calls/end for this agent's
        // active call, close it now so it doesn't stay stuck in ACTIVE.
        try {
          const stuckCall = await atp.calls.fetchOne({ status: 'ACTIVE', userId: user.id });
          if (stuckCall) {
            const endTime = new Date();
            const duration = stuckCall.startTime
              ? (endTime - new Date(stuckCall.startTime)) / 1000
              : null;
            await atp.calls.update(stuckCall.id, {
              status: 'COMPLETE',
              endTime,
              duration,
            });
            logger.warn(
              createStatusLog({
                operation: 'update',
                messageId,
                userId: user.id,
                slackId: user.slackId,
                status: 'AVAILABLE',
                previousStatus: 'ENGAGED',
                data: {
                  message: 'Auto-closed ACTIVE call record — /calls/end webhook missing',
                  callRecordId: stuckCall.id,
                  callId: stuckCall.callId,
                  duration,
                },
              })
            );
          }
        } catch (err) {
          logger.error({
            ...createStatusLog({
              operation: 'update',
              messageId,
              userId: user.id,
              status: 'AVAILABLE',
              previousStatus: 'ENGAGED',
              data: { message: 'Failed to auto-close ACTIVE call record' },
            }),
            ...formatError(err),
          });
        }

        await startWrapUp(user, logger);
        logger.info(
          createStatusLog({
            operation: 'update',
            messageId,
            userId: user.id,
            slackId: user.slackId,
            status: 'WRAP-UP',
            previousStatus: 'ENGAGED',
            data: {
              statusText: `Wrap Up @ ${moment(Date.now()).format('hh:mm a')}`,
              statusEmoji: ':hourglass_flowing_sand:',
              userName: user.nameFirst,
            },
          })
        );
        return;
      }
    }

    // If agent is in wrap-up and changes to a non-AVAILABLE status, clear the timer
    if (isInWrapUp(user.id)) {
      clearWrapUp(user.id);
      logger.info(
        createStatusLog({
          operation: 'update',
          messageId,
          userId: user.id,
          slackId: user.slackId,
          status: body.event_aux_type,
          previousStatus: 'WRAP-UP',
          data: {
            statusText: statusMap[body.event_aux_type]?.statusText,
            statusEmoji: statusMap[body.event_aux_type]?.statusEmoji,
            userName: user.nameFirst,
          },
        })
      );
    }

    if (statusMap[body.event_aux_type]) {
      await ava.status.update({
        slackId: user.slackId,
        ...statusMap[body.event_aux_type],
      });

      const updateData = {
        currentStatus: body.event_aux_type,
        statusSince: new Date(),
      };

      // Record first login/logout of the day
      if (body.event_aux_type === 'LOGIN' && (!user.lastLogin || !moment(user.lastLogin).isSame(moment(), 'day'))) {
        updateData.lastLogin = new Date();
      }
      if (body.event_aux_type === 'LOGOUT' && (!user.lastLogout || !moment(user.lastLogout).isSame(moment(), 'day'))) {
        updateData.lastLogout = new Date();
      }

      await atp.users.update(user.id, updateData);

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

      // When an agent becomes AVAILABLE, check if the next queued call is a callback
      if (body.event_aux_type === 'AVAILABLE') {
        await checkCallbackQueue(logger);
      }
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
