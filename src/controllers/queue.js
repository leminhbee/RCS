const ava = require('../AVA');
const { createQueueLog, formatError } = require('../helpers/log_schema');
const sfdcFunctions = require('../helpers/sfdc_functions');
const { sfdcConn } = require('../config/sfdc');
const atp = require('../ATP');

const add = async (req) => {
  const { messageId, body, logger, callRecord } = req;
  const callerNumber = body.caller_number;

  try {
    // 1. Add to AVA queue first
    await ava.queue.add(callerNumber, messageId);

    logger.info(
      createQueueLog({
        operation: 'add',
        callerNumber,
        messageId,
        callId: body.call_id,
        data: {
          source: 'queue_endpoint',
          body,
        },
      })
    );

    // 2. Check for existing call record (idempotency)
    if (callRecord) {
      logger.info(
        createQueueLog({
          operation: 'add',
          subOperation: 'DUPLICATE_QUEUE_WEBHOOK',
          callerNumber,
          messageId,
          callId: body.call_id,
          callRecordId: callRecord.id,
          data: { message: 'Call record already exists, skipping creation' },
        })
      );
      return callRecord;
    }

    // 3. Create unassigned Salesforce case and ATP call record
    await sfdcConn.authorize({ grant_type: 'client_credentials' });
    const tech = await sfdcFunctions.findTech(callerNumber, { messageId, ani: callerNumber }, logger);

    // Create unassigned case (no owner - defaults to API user)
    const caseRecord = await sfdcFunctions.createUnassignedCase(tech, callerNumber);
    logger.info(
      createQueueLog({
        operation: 'add',
        subOperation: 'CASE_CREATED',
        callerNumber,
        messageId,
        callId: body.call_id,
        caseId: caseRecord.id,
        data: { caseRecord },
      })
    );

    // Create ATP call record with QUEUED status (no userId yet)
    const callRecordCreated = await atp.calls.create({
      callerNumber: callerNumber,
      callId: body.call_id,
      callerName: tech ? `${tech.First_Name__c} ${tech.Last_Name__c}` : null,
      companyName: tech?.Account?.Name || null,
      userId: null,
      caseCreated: true,
      salesforceCaseId: caseRecord.id,
      salesforceCaseNumber: caseRecord.CaseNumber || null,
      startTime: new Date(),
      status: 'QUEUED',
    });

    logger.info(
      createQueueLog({
        operation: 'add',
        subOperation: 'CALL_RECORD_CREATED',
        callerNumber,
        messageId,
        callId: body.call_id,
        callRecordId: callRecordCreated.id,
        data: { callRecordCreated },
      })
    );

    return callRecordCreated;

  } catch (error) {
    logger.error({
      ...createQueueLog({
        operation: 'add',
        callerNumber,
        messageId,
        callId: body.call_id,
      }),
      ...formatError(error),
    });
  }
};

const remove = async (req) => {
  const { messageId, body, logger, callRecord } = req;
  const callerNumber = body.caller_number || body.ani;

  try {
    const isAbandoned = body.call_result === 'ABANDON';

    if (isAbandoned) {
      // Remove from AVA queue
      await ava.queue.remove(callerNumber, messageId, body.call_result, body);

      logger.info(
        createQueueLog({
          operation: 'remove',
          callerNumber,
          messageId,
          callId: body.call_id,
          data: {
            reason: body.call_result,
            hasRecording: body.recording_url ? body.recording_url.length > 0 : false,
            body,
          },
        })
      );

      // If we have a call record, close the case and update call record
      if (callRecord && callRecord.salesforceCaseId) {
        // Close the Salesforce case
        await sfdcConn.authorize({ grant_type: 'client_credentials' });
        await sfdcConn.sobject('Case').update({
          Id: callRecord.salesforceCaseId,
          Status: 'Closed',
        });

        logger.info(
          createQueueLog({
            operation: 'remove',
            subOperation: 'CASE_CLOSED',
            callerNumber,
            messageId,
            callId: body.call_id,
            caseId: callRecord.salesforceCaseId,
            data: { reason: 'Call abandoned' },
          })
        );

        // Update call record to ABANDONED
        await atp.calls.update(callRecord.id, {
          status: 'ABANDONED',
          endTime: new Date(),
        });

        logger.info(
          createQueueLog({
            operation: 'remove',
            subOperation: 'CALL_ABANDONED',
            callerNumber,
            messageId,
            callId: body.call_id,
            callRecordId: callRecord.id,
            data: { reason: body.call_result },
          })
        );
      } else {
        logger.warn(
          createQueueLog({
            operation: 'remove',
            subOperation: 'NO_CALL_RECORD',
            callerNumber,
            messageId,
            callId: body.call_id,
            data: { message: 'No call record found for abandoned call' },
          })
        );
      }
    } else {
      // Not abandoned (DEFLECTED, CONNECTED, etc), just log
      logger.info(
        createQueueLog({
          operation: 'remove',
          callerNumber,
          messageId,
          callId: body.call_id,
          data: {
            reason: body.call_result,
            message: 'Queue completed (not abandoned)',
          },
        })
      );
    }
  } catch (error) {
    logger.error({
      ...createQueueLog({
        operation: 'remove',
        callerNumber,
        messageId,
        callId: body.call_id,
      }),
      ...formatError(error),
    });
  }
};

const callback = async (req) => {
  const { messageId, body, logger, callRecord } = req;
  const callerNumber = body.caller_number;

  try {
    // Note: Do NOT remove from AVA queue - callback requests stay in queue

    logger.info(
      createQueueLog({
        operation: 'callback',
        callerNumber,
        messageId,
        callId: body.call_id,
        data: {
          source: 'callback_endpoint',
          body,
        },
      })
    );

    // Update call record status to CALLBACK_REQUESTED
    if (callRecord) {
      await atp.calls.update(callRecord.id, {
        status: 'CALLBACK_REQUESTED',
      });

      logger.info(
        createQueueLog({
          operation: 'callback',
          subOperation: 'CALLBACK_REQUESTED',
          callerNumber,
          messageId,
          callId: body.call_id,
          callRecordId: callRecord.id,
          data: { message: 'Call record updated to CALLBACK_REQUESTED' },
        })
      );
    } else {
      logger.warn(
        createQueueLog({
          operation: 'callback',
          subOperation: 'NO_CALL_RECORD',
          callerNumber,
          messageId,
          callId: body.call_id,
          data: { message: 'No call record found to update' },
        })
      );
    }
  } catch (error) {
    logger.error({
      ...createQueueLog({
        operation: 'callback',
        callerNumber,
        messageId,
        callId: body.call_id,
      }),
      ...formatError(error),
    });
  }
};

module.exports = {
  add,
  remove,
  callback
};
