require('dotenv').config();
const { createPrettyLogger } = require('./helpers/logger');
const logger = createPrettyLogger();
const { sfdcConn } = require('./config/sfdc');

// Function to format the number into (XXX) XXX-XXXX
function formatAsParentheses(number) {
  const areaCode = number.substring(0, 3);
  const prefix = number.substring(3, 6);
  const suffix = number.substring(6, 10);
  return `(${areaCode}) ${prefix}-${suffix}`;
}

const main = async () => {
  try {
    const phoneNumberToSearch = '2792209000';
    const formattedNumber = formatAsParentheses(phoneNumberToSearch);
    const soqlQuery = `SELECT Id, CaseNumber, Subject, Status, First_Name__c, Last_Name__c, AccountId
                      FROM Case 
                      WHERE Technician_Phone__c = '${phoneNumberToSearch}' 
                      OR Technician_Phone__c = '${formattedNumber}' 
                      LIMIT 1`;

    await sfdcConn.authorize({ grant_type: 'client_credentials' });
    const result = await sfdcConn.query(soqlQuery);
    logger.info(result.totalSize);
    logger.info(result.records[0]); // Access the first (and only) record directly
  } catch (error) {
    logger.error(error);
  }
};

main();
