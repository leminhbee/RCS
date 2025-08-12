const logger = require('../helpers/logger_calls');
const { sfdcConn } = require("../config/sfdc");
const sfdcFunctions = require('../helpers/sfdc_functions');
const atp = require('../ATP');

const answer = async (req) => {
  try {
    const body = req.body;

    if (!body.alulaUser.callsActive) return;
    await sfdcConn.authorize({ grant_type: "client_credentials" });
    const tech = await sfdcFunctions.findTech(body.ani);

    let caseCreated = false;
    let caseRecord;
    if (!req.retry) {
      logger.info('Creating salesforce case');
      caseRecord = await sfdcFunctions.createCase(tech, body)
      caseCreated = true;
    }

    const callRecordCreated = await atp.calls.create({
      callerNumber: body.ani,
      userId: body.alulaUser.id,
      caseCreated: caseCreated,
      salesforceCaseId: caseCreated ? caseRecord.id : null,
      startTime: new Date(),
    });
    logger.info({ callRecordCreated }, 'Call record created');
    return callRecordCreated;
  } catch (error) {
    logger.error({ error });
  }
};

const end = async (req) => {
  try {
    const body = req.body;
    if (!body.alulaUser.callsActive) return;
    logger.info(req);
    const callerNumber = body.ani;
    const endTime = new Date();

    let activeCallRecord = await atp.calls.fetchOne({
      callerNumber: callerNumber,
      userId: body.alulaUser.id,
      status: 'ACTIVE',
    }).catch(error => {
      logger.error({ error, event: 'callEnded', subEvent: 'findCallRecord' });
    });

    if (!activeCallRecord) {
      logger.error(`No active call record found for ANI: ${callerNumber}.`);
      req.retry = true;
      activeCallRecord = await answer(req);
    };

    const callDuration = (endTime - new Date(activeCallRecord.startTime)) / 1000;

    logger.info(callDuration);

    const callRecordUpdated = await atp.calls.update(activeCallRecord.id, {
      callLink: body.recording_url,
      endTime: endTime,
      duration: callDuration,
      status: 'COMPLETE',
    });

    logger.info({ callRecordUpdated }, `Call record updated`);

  } catch (error) {
    logger.error({ error });
  }
};

module.exports = {
  answer,
  end
};
