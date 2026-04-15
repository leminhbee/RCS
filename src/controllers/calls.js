const { sfdcConn } = require('../config/sfdc');
const sfdcFunctions = require('../helpers/sfdc_functions');
const { createCallLog, formatError } = require('../helpers/log_schema');
const atp = require('../ATP');
const ava = require('../AVA');
const moment = require('moment');
const { clearCallbackTimer } = require('../helpers/callback_timers');

/**
 * Parse a datetime string that's in America/Chicago (Central Time).
 * Automatically handles CST (UTC-6) vs CDT (UTC-5) without hardcoding an offset.
 */
function parseCentralTime(dateStr) {
  const approx = new Date(dateStr.replace(' ', 'T') + 'Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(approx);
  const get = type => parts.find(p => p.type === type).value;
  const ctAsUtc = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
  return new Date(approx.getTime() + (approx - ctAsUtc));
}

const answer = async (req) => {
  const { messageId, body, logger, callRecord } = req;

  try {
    // Regular user checks
    if (!body.alulaUser?.callsActive) return; // Early return if user is not activated for call tracking

    // If we found an existing call record, update it
    if (callRecord) {
      await sfdcConn.authorize({ grant_type: 'client_credentials' });

      // Update Salesforce case with agent as owner and add recording URL
      await sfdcConn.sobject('Case').update({
        Id: callRecord.salesforceCaseId,
        OwnerId: body.alulaUser.sfdcId,
        Jive_URL__c: body.call_recording,
      });

      logger.info(
        createCallLog({
          operation: 'answer',
          subOperation: 'CASE_UPDATED',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: body.alulaUser.id,
          caseId: callRecord.salesforceCaseId,
          data: {
            message: 'Case owner updated to agent',
            ownerId: body.alulaUser.sfdcId,
            agentName: `${body.alulaUser.nameFirst} ${body.alulaUser.nameLast}`,
          },
        })
      );

      const queueDuration = body.enqueue_time && body.dequeue_time
        ? Math.round((new Date(body.dequeue_time) - new Date(body.enqueue_time)) / 1000)
        : null;

      const updatedCallRecord = await atp.calls.update(callRecord.id, {
        callId: body.call_id,
        userId: body.alulaUser.id,
        status: 'ACTIVE',
        callLink: body.call_recording,
        queueDuration,
      });

      logger.info(
        createCallLog({
          operation: 'answer',
          subOperation: 'CALL_RECORD_UPDATED',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: body.alulaUser.id,
          callRecordId: callRecord.id,
          data: {
            message: 'Call record updated to ACTIVE',
            updatedCallRecord,
          },
        })
      );

      return updatedCallRecord;
    } else {
      // Fallback: No existing call record found (race condition or queue webhook missed)
      logger.warn(
        createCallLog({
          operation: 'answer',
          subOperation: 'NO_CALL_RECORD_FOUND',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: body.alulaUser.id,
          data: {
            message: 'No existing call record found, creating new case and call record',
          },
        })
      );

      let caseCreated = false;
      let caseRecord;
      await sfdcConn.authorize({ grant_type: 'client_credentials' });
      const tech = await sfdcFunctions.findTech(body.ani, { messageId, ani: body.ani }, logger);

      if (!req.retry) {
        caseRecord = await sfdcFunctions.createCase(tech, body);
        caseCreated = true;
        logger.info(
          createCallLog({
            operation: 'answer',
            subOperation: 'FALLBACK_CASE_CREATED',
            messageId,
            ani: body.ani,
            callId: body.call_id,
            userId: body.alulaUser.id,
            caseId: caseRecord.id,
            data: {
              message: 'Fallback case created for unanswered call',
              caseRecord,
            },
          })
        );
      }
      const queueDuration = body.enqueue_time && body.dequeue_time
      ? Math.round((new Date(body.dequeue_time) - new Date(body.enqueue_time)) / 1000)
      : null;

      const callRecordCreated = await atp.calls.create({
        callerNumber: body.ani,
        callId: body.call_id,
        callerName: tech ? [tech.First_Name__c, tech.Last_Name__c].filter(Boolean).join(' ') :null,
        companyName: tech?.Account?.Name || null,
        userId: body.alulaUser.id,
        caseCreated: caseCreated,
        salesforceCaseId: caseCreated ? caseRecord.id : null,
        salesforceCaseNumber: caseCreated ? caseRecord.CaseNumber : null,
        startTime: new Date(),
        status: 'ACTIVE',
        callLink: body.call_recording,
        queueDuration,
      });

      logger.info(
        createCallLog({
          operation: 'answer',
          subOperation: 'FALLBACK_CALL_CREATED',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: body.alulaUser.id,
          callRecordId: callRecordCreated.id,
          data: {
            message: 'Fallback call record created with ACTIVE status',
            callRecordCreated,
          },
        })
      );

      return callRecordCreated;
    }
  } catch (error) {
    logger.error({
      ...createCallLog({
        operation: 'answer',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: body.alulaUser?.id,
      }),
      ...formatError(error),
    });
  }
};

const end = async (req) => {
  let { messageId, body, logger, callRecord } = req;

  logger.info(
    createCallLog({
      operation: 'end',
      messageId,
      ani: body.ani,
      callId: body.call_id,
      userId: body.alulaUser?.id,
      data: {
        message: 'Call end event received',
        body,
      },
    })
  );

  try {
    if (!body.alulaUser?.callsActive) return; // Early return if user is not activated for call tracking
    if (body.alulaUser?.supervisor && body.event_type === 'ONE-TO-ONE-OUTBOUND') return; // Skip outbound tracking for supervisors

    // ONE-TO-ONE-OUTBOUND: outbound call ended (no prior /calls/answer)
    if (body.event_type === 'ONE-TO-ONE-OUTBOUND') {
      const callerNumber = body.dnis;
      const endTime = new Date();
      const startTime = body.call_start ? parseCentralTime(body.call_start) : endTime;
      const callDuration = body.call_duration
        ? Number(body.call_duration)
        : (endTime - startTime) / 1000;

      // Search for most recent call by dnis + user for today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      await sfdcConn.authorize({ grant_type: 'client_credentials' });
      const tech = await sfdcFunctions.findTech(callerNumber, { messageId, ani: callerNumber }, logger);

      const recentCalls = await atp.calls.fetchAll({
        callerNumber,
        userId: body.alulaUser.id,
      });

      const previousCall = recentCalls
        ?.filter(c => new Date(c.startTime) >= todayStart)
        ?.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
        ?.[0] || null;

      if (previousCall) {
        // Found a previous call — copy case info, create new record with its own recording
        const newCallRecord = await atp.calls.create({
          callerNumber,
          callId: body.call_id,
          callerName: tech ? [tech.First_Name__c, tech.Last_Name__c].filter(Boolean).join(' ') :previousCall.callerName,
          companyName: tech?.Account?.Name || previousCall.companyName,
          salesforceCaseId: previousCall.salesforceCaseId,
          salesforceCaseNumber: previousCall.salesforceCaseNumber,
          userId: body.alulaUser.id,
          caseCreated: !!previousCall.salesforceCaseId,
          startTime,
          endTime,
          duration: callDuration,
          status: 'COMPLETE',
          callLink: body.recording_url,
          outbound: true,
        });

        logger.info(
          createCallLog({
            operation: 'end',
            subOperation: 'OUTBOUND_PREVIOUS_CALL_FOUND',
            messageId,
            ani: body.ani,
            callId: body.call_id,
            userId: body.alulaUser.id,
            callRecordId: newCallRecord.id,
            data: {
              message: 'Outbound call linked to previous call case',
              previousCallId: previousCall.id,
              salesforceCaseId: previousCall.salesforceCaseId,
            },
          })
        );

        // Append new recording URL to Salesforce case, or notify AVA if no case exists
        if (previousCall.salesforceCaseId) {
          const existingCase = await sfdcConn.sobject('Case').retrieve(previousCall.salesforceCaseId);
          const existingUrl = existingCase.Jive_URL__c || '';
          const updatedUrl = existingUrl ? `${existingUrl}\n${body.recording_url}` : body.recording_url;

          await sfdcConn.sobject('Case').update({
            Id: previousCall.salesforceCaseId,
            Jive_URL__c: updatedUrl,
          });

          logger.info(
            createCallLog({
              operation: 'end',
              subOperation: 'OUTBOUND_CASE_URL_APPENDED',
              messageId,
              ani: body.ani,
              callId: body.call_id,
              userId: body.alulaUser.id,
              caseId: previousCall.salesforceCaseId,
              data: {
                message: 'Appended outbound recording URL to Salesforce case',
              },
            })
          );
        } else {
          await ava.outbound.notify(callerNumber, newCallRecord.id, body.alulaUser.slackId, body.recording_url);
        }
      } else {
        // No previous call found — create record and notify AVA
        const newCallRecord = await atp.calls.create({
          callerNumber,
          callId: body.call_id,
          callerName: tech ? [tech.First_Name__c, tech.Last_Name__c].filter(Boolean).join(' ') :null,
          companyName: tech?.Account?.Name || null,
          userId: body.alulaUser.id,
          startTime,
          endTime,
          duration: callDuration,
          status: 'COMPLETE',
          callLink: body.recording_url,
          outbound: true,
        });

        logger.info(
          createCallLog({
            operation: 'end',
            subOperation: 'OUTBOUND_NO_PREVIOUS_CALL',
            messageId,
            ani: body.ani,
            callId: body.call_id,
            userId: body.alulaUser.id,
            callRecordId: newCallRecord.id,
            data: {
              message: 'Outbound call with no previous call found, notifying AVA',
            },
          })
        );

        await ava.outbound.notify(callerNumber, newCallRecord.id, body.alulaUser.slackId, body.recording_url);
      }

      return;
    }

    // RNA: no recording and call record was in RINGING state — caller hung up while ringing
    if (body.recording_url.length === 0 && callRecord?.status === 'RINGING') {
      await atp.calls.update(callRecord.id, {
        status: 'ABANDONED',
        endTime: new Date(),
      });

      logger.info(
        createCallLog({
          operation: 'end',
          subOperation: 'RNA_ABANDONED',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: body.alulaUser.id,
          callRecordId: callRecord.id,
          data: { message: 'Call abandoned while ringing (RNA)' },
        })
      );
      return;
    }

    const endTime = new Date();

    if (!callRecord) {
      logger.warn(
        createCallLog({
          operation: 'end',
          subOperation: 'NO_ACTIVE_CALL',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: body.alulaUser.id,
          data: {
            message: 'No active call record found, calling answer to create one',
            body,
          },
        })
      );
      req.retry = true;
      callRecord = await answer(req);
    }

    const callDuration = (endTime - new Date(callRecord.startTime)) / 1000;

    const callRecordUpdated = await atp.calls.update(callRecord.id, {
      callLink: body.recording_url,
      endTime: endTime,
      duration: callDuration,
      status: 'COMPLETE',
    });

    logger.info(
      createCallLog({
        operation: 'end',
        subOperation: 'CALL_RECORD_UPDATED',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: body.alulaUser.id,
        callRecordId: callRecord.id,
        data: {
          message: 'Call record updated to COMPLETE',
          callRecordUpdated,
        },
      })
    );

  } catch (error) {
    logger.error({
      ...createCallLog({
        operation: 'end',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: body.alulaUser?.id,
      }),
      ...formatError(error),
    });
  }
};

const ringing = async (req) => {
  const { messageId, body, logger, callRecord } = req;
  const user = body.alulaUser;

  try {
    logger.info(
      createCallLog({
        operation: 'ringing',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: user?.id,
        data: { body },
      })
    );

    // Update call record to RINGING with assigned agent
    if (callRecord) {
      // If this was a callback, clear the expiration timer — the callback is working
      if (callRecord.status === 'CALLBACK_REQUESTED') {
        clearCallbackTimer(callRecord.id);
      }

      await atp.calls.update(callRecord.id, {
        status: 'RINGING',
        userId: user.id,
      });

      logger.info(
        createCallLog({
          operation: 'ringing',
          subOperation: 'CALL_RECORD_UPDATED',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: user.id,
          callRecordId: callRecord.id,
          data: { status: 'RINGING' },
        })
      );
    } else {
      logger.warn(
        createCallLog({
          operation: 'ringing',
          subOperation: 'NO_CALL_RECORD',
          messageId,
          ani: body.ani,
          callId: body.call_id,
          userId: user?.id,
          data: { message: 'No call record found to update' },
        })
      );
    }

    // Update Slack status
    if (user && !user.supervisor) {
      ava.status.update({
        slackId: user.slackId,
        statusText: `Ringing @ ${moment(Date.now()).format('hh:mm a')}`,
        statusEmoji: ':bell:',
      });
    }

    // Update dashboard status
    if (user) {
      atp.users.update(user.id, {
        currentStatus: 'RINGING',
        statusSince: new Date(),
      });
    }
  } catch (error) {
    logger.error({
      ...createCallLog({
        operation: 'ringing',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: user?.id,
      }),
      ...formatError(error),
    });
  }
};

const transfer = async (req) => {
  const { messageId, body, logger, callRecord } = req;
  const user = body.alulaUser;

  try {
    logger.info(
      createCallLog({
        operation: 'transfer',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: user?.id,
        callRecordId: callRecord?.id,
        data: {
          message: 'Transfer event received',
          body,
        },
      })
    );
  } catch (error) {
    logger.error({
      ...createCallLog({
        operation: 'transfer',
        messageId,
        ani: body.ani,
        callId: body.call_id,
        userId: user?.id,
      }),
      ...formatError(error),
    });
  }
};

module.exports = {
  answer,
  end,
  ringing,
  transfer,
};
