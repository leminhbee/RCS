const { sfdcConn } = require('../config/sfdc');
const sfdcFunctions = require('../helpers/sfdc_functions');
const { createCallLog, formatError } = require('../helpers/log_schema');
const atp = require('../ATP');
const ava = require('../AVA');
const fs = require('fs').promises;
const path = require('path');
const callsFolder = path.join(__dirname, '..', 'calls');

const answer = async (req) => {
  const { messageId, body, logger } = req;

  const callFile = path.join(callsFolder, `${req.body.ani}.txt`);
  const date = new Date();

  try {
    if (!body.alulaUser.callsActive) return; // Early return if user is not activated for call tracking

    // Log call answered
    logger.info(createCallLog({
      operation: 'answer',
      messageId,
      ani: body.ani,
      userId: body.alulaUser.id,
      data: {
        userName: body.alulaUser.nameFirst,
        callRecording: body.call_recording
      }
    }));

    await ava.queue.remove(callFile, date); // Remove from queue when call is answered
    await fs.appendFile(callFile, date +  ':: CALL ANSWERED BY: ' + body.alulaUser.nameFirst + '\n');
    await fs.appendFile(callFile, date +  ':: CALL RECORDING URL: ' + body.call_recording + '\n');

    let caseCreated = false;
    let caseRecord;
    await sfdcConn.authorize({ grant_type: 'client_credentials' });

    const tech = await sfdcFunctions.findTech(body.ani,
      createCallLog({ operation: 'answer', subOperation: 'FIND_TECH', messageId, ani: body.ani }),
      logger
    );

    if (!req.retry) {
      caseRecord = await sfdcFunctions.createCase(tech, body);
      caseCreated = true;
      await fs.appendFile(callFile, date +  ':: CASE CREATED\n');

      logger.info(createCallLog({
        operation: 'answer',
        subOperation: 'CASE_CREATED',
        messageId,
        ani: body.ani,
        userId: body.alulaUser.id,
        caseId: caseRecord.id,
        data: {
          caseNumber: caseRecord.CaseNumber,
          subject: caseRecord.Subject
        }
      }));
    }

    const callRecordCreated = await atp.calls.create({
      callerNumber: body.ani,
      callerName: tech ? `${tech.First_Name__c} ${tech.Last_Name__c}` : null,
      userId: body.alulaUser.id,
      caseCreated: caseCreated,
      salesforceCaseId: caseCreated ? caseRecord.id : null,
      startTime: new Date(),
    });

    logger.info(createCallLog({
      operation: 'answer',
      subOperation: 'CALL_RECORD_CREATED',
      messageId,
      ani: body.ani,
      userId: body.alulaUser.id,
      callerName: tech ? `${tech.First_Name__c} ${tech.Last_Name__c}` : null,
      caseId: caseCreated ? caseRecord.id : null,
      callRecordId: callRecordCreated.id,
      data: { callRecordCreated }
    }));

    return callRecordCreated;
  } catch (error) {
    logger.error({
      ...createCallLog({
        operation: 'answer',
        messageId,
        ani: body.ani,
        userId: body.alulaUser?.id
      }),
      ...formatError(error)
    });
  }
};

const end = async (req) => {
  const { messageId, body, logger } = req;

  const callFile = path.join(callsFolder, `${req.body.ani}.txt`);
  const doneFile = path.join(callsFolder, `${req.body.ani}_DONE.txt`);
  const date = new Date();

  logger.info(createCallLog({
    operation: 'end',
    messageId,
    ani: body.ani,
    userId: body.alulaUser?.id,
    data: {
      recordingUrl: body.recording_url
    }
  }));

  try {
    if (!body.alulaUser.callsActive) return; // Early return if user is not activated for call tracking
    if (body.recording_url.length === 0) return; // Early return for no call recording, thinking this is the only way to tell the difference of RNA

    const callerNumber = body.ani;
    const endTime = new Date();
    await fs.appendFile(callFile, date + ':: CALL DONE\n');
    await fs.rename(callFile, doneFile);

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
            userId: body.alulaUser.id
          }),
          ...formatError(error)
        });
      });

    if (!activeCallRecord) {
      logger.warn({
        ...createCallLog({
          operation: 'end',
          subOperation: 'FIND_CALL',
          messageId,
          ani: body.ani,
          userId: body.alulaUser.id
        }),
        warning: 'No active call record found, creating one with no case'
      });
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

    logger.info(createCallLog({
      operation: 'end',
      subOperation: 'CALL_RECORD_UPDATED',
      messageId,
      ani: body.ani,
      userId: body.alulaUser.id,
      callRecordId: activeCallRecord.id,
      data: {
        duration: callDuration,
        recordingUrl: body.recording_url,
        callRecordUpdated
      }
    }));
  } catch (error) {
    logger.error({
      ...createCallLog({
        operation: 'end',
        messageId,
        ani: body.ani,
        userId: body.alulaUser?.id
      }),
      ...formatError(error)
    });
  }
};

module.exports = {
  answer,
  end,
};
