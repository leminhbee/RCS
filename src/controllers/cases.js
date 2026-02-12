const { sfdcConn } = require('../config/sfdc');
const sfdcFunctions = require('../helpers/sfdc_functions');
const atp = require('../ATP');

const closed = async (req) => {
  const { logger } = req;
  try {
    const notifications =
      req.body?.['soapenv:envelope']?.['soapenv:body']?.notifications?.notification;

    const cases = [];
    if (Array.isArray(notifications)) {
      logger.info('IS ARRAY!!!!');
      for (const notification of notifications) {
        const caseId =  notification.sobject['sf:id'];
        const sfdcUser = notification.sobject['sf:createdbyid'];
        const user = await atp.users.fetchOne({ sfdcId: sfdcUser });
        if (!user) continue;
        cases.push({ id: caseId, sfdcUser: sfdcUser, });
      }
    } else if (notifications) {
      const caseId = notifications.sobject['sf:id'];
      const sfdcUser = notifications.sobject['sf:createdbyid'];
      const user = await atp.users.fetchOne({ sfdcId: sfdcUser });
      if (!user) return;
      cases.push({ id: caseId, sfdcUser: sfdcUser, });
    }

    if (cases.length === 0 ) return; // Early return if no cases for users were added
    const callRecords = [];
    for (const caseRecord of cases) {
      callRecords.push(await atp.calls.fetchOne({ salesforceCaseId: caseRecord.id }));
    }
    logger.info({ messageId: req.messageId, callRecords }, 'Case closed');
    // await sfdcConn.authorize({ grant_type: "client_credentials" });
  } catch (error) {
    logger.error({ req, error });
  }
};

module.exports = {
  closed,
};
