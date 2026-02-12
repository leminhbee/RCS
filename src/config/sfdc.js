const jsforce = require('jsforce');

const sfdcConn = new jsforce.Connection({
  oauth2: {
    clientId: process.env.SFDC_KEY,
    clientSecret: process.env.SFDC_SECRET,
    loginUrl: process.env.SFDC_URL,
  },
});

module.exports = {
  sfdcConn,
};
