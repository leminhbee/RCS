const axios = require('axios');
const { createLogger } = require('../helpers/logger');
const logger = createLogger();
const atp_url = process.env.ATP_URL;
const { validate: isUUID } = require('uuid'); // Import the UUID validation function

async function create(options) {
  try {
    const response = await axios.post(`${atp_url}/calls`, options);
    return response.data;
  } catch (error) {
    logger.error({ error }, 'Error writing calls to database');
    throw new Error('Error writing new call to database');
  }
}

/**
 * Fetches a single call record from the ATP API.
 * The function accepts a single 'options' parameter which can be one of two types:
 * - A string: A valid UUID to fetch a call record by its unique ID.
 * - An object: A filter object to find a call record that matches specific criteria.
 * @param {string|object} options - The unique ID as a string or a filter object.
 * @returns {Promise<object|null>} - A promise that resolves to the fetched call record or null if not found.
 * @throws {Error} Throws an error if the input is invalid or a network error occurs.
 */
async function fetchOne(options) {
  try {
    let response;
    if (typeof options === 'object' && options !== null) {
      // User is providing a filter, so call the findOne endpoint
      response = await axios.get(`${atp_url}/calls/findOne`, {
        params: { filter: options },
      });
      return response.data; // This will be the found object or null from the API
    } else if (typeof options === 'string' && isUUID(options)) {
      // User is providing a UUID, so call the specific ID endpoint
      response = await axios.get(`${atp_url}/calls/${options}`);
      return response.data; // This will be the found object
    } else {
      // Throw an error for invalid input
      throw new Error('Invalid params: Please provide a valid filter object or a UUID string.');
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    } else if (error.message.includes('Invalid params')) {
      throw error;
    } else {
      throw new Error('Error getting call record from ATP: ' + error.message);
    }
  }
}

async function update(id, data) {
  try {
    const response = await axios.patch(`${atp_url}/calls/${id}`, data);
    return response.data;
  } catch (error) {
    logger.error({ error }, 'ATP Update Error');
    throw new Error('Error updating call record in ATP');
  }
}

module.exports = {
  create,
  fetchOne,
  update,
};
