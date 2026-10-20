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

    const soqlQuery = `SELECT Id, CaseNumber, Subject, Status, First_Name__c, Last_Name__c, AccountId, Account.Name
                      FROM Case
                      WHERE Technician_Phone__c = '${number}'
                      OR Technician_Phone__c = '${formattedNumber}'
                      ORDER BY CreatedDate DESC
                      LIMIT 1`;
    const result = await sfdcConn.query(soqlQuery);

    if (result.totalSize < 1) return null;

    const tech = result.records[0];
    const toTitleCase = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : str;
    tech.First_Name__c = toTitleCase(tech.First_Name__c);
    tech.Last_Name__c = toTitleCase(tech.Last_Name__c);

    logger.info({ ...commonLog, subEvent: 'FIND TECH', tech }, 'Tech found');
    return tech;
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
  const caseRecord = await sfdcConn.sobject('Case').retrieve(createdCase.id, ['CaseNumber']);
  return { id: createdCase.id, CaseNumber: caseRecord.CaseNumber };
};

const createUnassignedCase = async (tech, callerNumber) => {
  const formattedNumber = formatAsParentheses(callerNumber);
  const data = {
    Subject: callerNumber,
    Technician_Phone__c: formattedNumber,
    // OwnerId and CreatedById omitted - will default to API user
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
  const caseRecord = await sfdcConn.sobject('Case').retrieve(createdCase.id, ['CaseNumber']);
  return { id: createdCase.id, CaseNumber: caseRecord.CaseNumber };
};

module.exports = {
  findTech,
  createCase,
  createUnassignedCase,
};
