const { sfdcConn } = require('../config/sfdc');
const sfdcFunctions = require('../helpers/sfdc_functions');
const { createCallLog, formatError } = require('../helpers/log_schema');
const atp = require('../ATP');
const ava = require('../AVA');
const moment = require('moment');


const answer = async (req) => {
  const { messageId, body, logger, callRecord } = req;

  try {
    // Remove from queue first, before any user checks
    if (!req.retry) {
      await ava.queue.remove(body.ani, messageId, 'CALL_ANSWERED', body);
    }

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

      // Update call record with userId, status ACTIVE, and recording URL
      const updatedCallRecord = await atp.calls.update(callRecord.id, {
        userId: body.alulaUser.id,
        status: 'ACTIVE',
        callLink: body.call_recording,
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

      const callRecordCreated = await atp.calls.create({
        callerNumber: body.ani,
        callId: body.call_id,
        callerName: tech ? `${tech.First_Name__c} ${tech.Last_Name__c}` : null,
        companyName: tech?.Account?.Name || null,
        userId: body.alulaUser.id,
        caseCreated: caseCreated,
        salesforceCaseId: caseCreated ? caseRecord.id : null,
        startTime: new Date(),
        status: 'ACTIVE',
        callLink: body.call_recording,
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

    if (body.recording_url.length === 0) return; // Early return for no call recording (non-RINGING)

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

module.exports = {
  answer,
  end,
  ringing,
};
