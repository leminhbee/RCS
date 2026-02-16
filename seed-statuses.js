require('dotenv').config();
const atp = require('./src/ATP');

(async () => {
  try {
    const results = await atp.users.fetchAll({supervisor: true });
    console.log(results);
  } catch (err) {
    console.error(err);
  }
})();
