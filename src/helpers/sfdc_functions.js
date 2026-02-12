const { sfdcConn } = require('../config/sfdc');

const formatAsParentheses = (number) => {
  const areaCode = number.substring(0, 3);
  const prefix = number.substring(3, 6);
  const suffix = number.substring(6, 10);
  return `(${areaCode}) ${prefix}-${suffix}`;
};

const findTech = async (number, commonLog, logger) => {
  try {
    const formattedNumber = formatAsParentheses(number);

    const soqlQuery = `SELECT Id, CaseNumber, Subject, Status, First_Name__c, Last_Name__c, AccountId
                      FROM Case
                      WHERE Technician_Phone__c = '${number}'
                      OR Technician_Phone__c = '${formattedNumber}'
                      LIMIT 1`;
    const result = await sfdcConn.query(soqlQuery);

    if (result.totalSize < 1) return null;

    logger.info({ ...commonLog, subEvent: 'FIND TECH', tech: result.records[0] }, 'Tech found');
    return result.records[0];
  } catch (error) {
    logger.error({ ...commonLog, subEvent: 'FIND TECH', error }, 'Unable to find tech');
    return null;
  }
};

const createCase = async (tech, body) => {
  const formattedNumber = formatAsParentheses(body.ani);
  const data = {
    Subject: body.ani,
    Technician_Phone__c: formattedNumber,
    OwnerId: body.alulaUser.sfdcId,
    CreatedById: body.alulaUser.sfdcId,
    Jive_URL__c: body.call_recording,
  };

  if (tech) {
    data.AccountId = tech.AccountId;
    data.First_Name__c = tech.First_Name__c;
    data.Last_Name__c = tech.Last_Name__c;
  }

  const createdCase = await sfdcConn.sobject('Case').create(data);

  if (createdCase.errors.length > 0) {
    throw createdCase.errors[0];
  }
  return createdCase;
};

module.exports = {
  findTech,
  createCase,
};
