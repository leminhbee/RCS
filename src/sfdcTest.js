require('dotenv').config();
const logger = require('./helpers/logger_calls');
const { sfdcConn } = require("./config/sfdc");

// Function to format the number into (XXX) XXX-XXXX
function formatAsParentheses(number) {
  const areaCode = number.substring(0, 3);
  const prefix = number.substring(3, 6);
  const suffix = number.substring(6, 10);
  return `(${areaCode}) ${prefix}-${suffix}`;
}



const main = async () => {
  try {
    const phoneNumberToSearch = '(279) 220-9094';
    const formattedNumber = formatAsParentheses(phoneNumberToSearch);
    const soqlQuery = `SELECT AccountId, First_Name__c, Last_Name__c, Technician_Phone__c FROM Case WHERE Technician_Phone__c = '${phoneNumberToSearch}' OR Technician_Phone__c = '${formattedNumber}' LIMIT 1`;

    await sfdcConn.authorize({ grant_type: "client_credentials" });
    const result = await sfdcConn.query(soqlQuery);
    logger.info(result.totalSize);
    logger.info(result.records[0]); // Access the first (and only) record directly
  } catch (error) {
    logger.error(error);
  }
  
}


main();