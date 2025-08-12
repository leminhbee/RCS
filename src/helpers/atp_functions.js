const atp = require('../ATP');
const logger = require('./logger_calls');

const createCall = async (createdCase, body) => {
  const callRecordCreated = await atp.calls.create({
    callerNumber: body.ani,
    userId: body.alulaUser.id,
    caseCreated: true,
    salesforceCaseId: createdCase.id,
    startTime: new Date(),
  });
  logger.info({ callRecordCreated }, 'Call record created');
  return callRecordCreated;
}

const endCall = async (body) => {
  const callerNumber = body.ani;
  let activeCallRecord = await atp.calls.fetchOne({
    callerNumber: callerNumber,
    userId: body.alulaUser.id,
    status: 'ACTIVE',
  })

  if (!activeCallRecord) {
    logger.error(`No active call record found for ANI: ${callerNumber}.`);
    activeCallRecord = await answer(req);
  };

  const callDuration = endTime - activeCallRecord.startTime;

  const callRecordUpdated = await atp.calls.update(activeCallRecord.id, {
    callLink: body.recording_url,
    endTime: endTime,
    duration: callDuration,
    status: 'COMPLETE',
  });

  logger.info({ callRecordUpdated }, `Call record updated`);
}

module.exports = {
  createCall,
  endCall
}