const axios = require('axios');
const logger = require('../helpers/logger');
const atp_url = process.env.ATP_URL;

async function create(gotoId, startTime) {
  try {
    const response = await axios.post(`${atp_url}/breaks`, {
      gotoId: gotoId,
      startTime: startTime,
    });
    return response.data;
  } catch (error) {
    logger.error({ error }, 'Error writing break to database');
    throw new Error(`Error inserting break start: ${error.message}`);
  }
}

async function fetchOne(breakId) {
  try {
    const response = await axios.get(`${atp_url}/breaks/${breakId}`);
    return response.data;
  } catch (error) {
    logger.error({ error }, 'Error while fetching breakId: ' + breakId);
    throw new Error('Error fetching breakID: ' + breakId);
  }
}

async function update(breakId, data) {
  try {
    return await axios.patch(`${atp_url}/breaks/${breakId}`, data);
  } catch (error) {
    logger.error({ error }, 'Error updating break record: ' + breakId);
    throw new Error('Error updating break record: ' + breakId);
  }
}

module.exports = {
  create,
  fetchOne,
  update,
};
