const { sfdcConn } = require('../config/sfdc');
const sfdcFunctions = require('../helpers/sfdc_functions');
const { createCallLog, formatError } = require('../helpers/log_schema');
const atp = require('../ATP');
const ava = require('../AVA');


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
            userId: body.alulaUser.id,
            caseId: caseRecord.id,
            data: {
              caseRecord,
            },
          })
        );
      }

      const callRecordCreated = await atp.calls.create({
        callerNumber: body.ani,
        callerName: tech ? `${tech.First_Name__c} ${tech.Last_Name__c}` : null,
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
          userId: body.alulaUser.id,
          callRecordId: callRecordCreated.id,
          data: {
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
        userId: body.alulaUser?.id,
      }),
      ...formatError(error),
    });
  }
};

const end = async (req) => {
  const { messageId, body, logger, callRecord } = req;

  logger.info(
    createCallLog({
      operation: 'end',
      messageId,
      ani: body.ani,
      userId: body.alulaUser?.id,
      data: {
        body,
      },
    })
  );

  try {
    if (!body.alulaUser.callsActive) return; // Early return if user is not activated for call tracking
    if (body.recording_url.length === 0) return; // Early return for no call recording (RNA)

    const endTime = new Date();
    let activeCallRecord = callRecord;

    // If no call record from middleware or it's not ACTIVE, try to find one
    if (!activeCallRecord || activeCallRecord.status !== 'ACTIVE') {
      activeCallRecord = await atp.calls
        .fetchOne({
          callerNumber: body.ani,
          userId: body.alulaUser.id,
          status: 'ACTIVE',
        })
        .catch((error) => {
          logger.error({
            ...createCallLog({
              operation: 'end',
              subOperation: 'FIND_CALL',
              messageId,
              ani: body.ani,
              userId: body.alulaUser.id,
            }),
            ...formatError(error),
          });
        });
    }

    if (!activeCallRecord) {
      logger.warn(
        createCallLog({
          operation: 'end',
          subOperation: 'NO_ACTIVE_CALL',
          messageId,
          ani: body.ani,
          userId: body.alulaUser.id,
          data: {
            message: 'No active call record found, calling answer to create one',
            body,
          },
        })
      );
      req.retry = true;
      activeCallRecord = await answer(req);
    }

    const callDuration = (endTime - new Date(activeCallRecord.startTime)) / 1000;

    const callRecordUpdated = await atp.calls.update(activeCallRecord.id, {
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
        userId: body.alulaUser.id,
        callRecordId: activeCallRecord.id,
        data: {
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
        userId: body.alulaUser?.id,
      }),
      ...formatError(error),
    });
  }
};

module.exports = {
  answer,
  end,
};
