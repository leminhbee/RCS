const { sfdcConn } = require('../config/sfdc');
const sfdcFunctions = require('../helpers/sfdc_functions');
const { createCallLog, formatError } = require('../helpers/log_schema');
const atp = require('../ATP');
const ava = require('../AVA');


const answer = async (req) => {
  const { messageId, body, logger } = req;

  try {
    // Remove from queue first, before any user checks
    if (!req.retry) {
      await ava.queue.remove(body.ani, messageId, 'CALL_ANSWERED', body);
    }

    // If supervisor, just log and exit (no case or call record creation)
    if (body.isSupervisor) {
      logger.info(
        createCallLog({
          operation: 'answer',
          subOperation: 'SUPERVISOR_CALL',
          messageId,
          ani: body.ani,
          data: {
            message: 'Supervisor answered call, removed from queue',
            body,
          },
        })
      );
      return;
    }

    // Regular user checks
    if (!body.alulaUser?.callsActive) return; // Early return if user is not activated for call tracking

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
          subOperation: 'CASE_CREATED',
          messageId,
          ani: body.ani,
          userId: body.alulaUser.id,
          caseId: caseRecord.id,
          data: {
            caseRecord,
            body,
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
    });

    logger.info(
      createCallLog({
        operation: 'answer',
        subOperation: 'CALL_RECORD_CREATED',
        messageId,
        ani: body.ani,
        userId: body.alulaUser.id,
        callRecordId: callRecordCreated.id,
        callerName: tech ? `${tech.First_Name__c} ${tech.Last_Name__c}` : null,
        data: {
          callRecordCreated,
          body,
        },
      })
    );

    return callRecordCreated;
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
  const { messageId, body, logger } = req;

  const callFile = path.join(callsFolder, `${req.body.ani}.txt`);
  const doneFile = path.join(callsFolder, `${req.body.ani}_DONE.txt`);
  const date = new Date();

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
    if (body.recording_url.length === 0) return; // Early return for no call recording, thinking this is the only way to tell the difference of RNA
    const callerNumber = body.ani;
    const endTime = new Date();
    let activeCallRecord = await atp.calls
      .fetchOne({
        callerNumber: callerNumber,
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

    if (!activeCallRecord) {
      logger.warn(
        createCallLog({
          operation: 'end',
          subOperation: 'NO_ACTIVE_CALL',
          messageId,
          ani: body.ani,
          userId: body.alulaUser.id,
          data: {
            message: 'No active call record, creating one with no case',
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
          body,
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
