const axios = require('./client');
const { createLogger } = require('../helpers/logger');
const logger = createLogger();
const { validate: isUUID } = require('uuid');

async function create(options) {
  try {
    const response = await axios.post(`/breaks`, options);
    return response.data;
  } catch (error) {
    logger.error({ error }, 'Error writing break to database');
    throw new Error('Error writing new break to database');
  }
}

/**
 * Fetches a single break record from the ATP API.
 * The function accepts a single 'options' parameter which can be one of two types:
 * - A string: A valid UUID to fetch a break record by its unique ID.
 * - An object: A filter object to find a break record that matches specific criteria.
 * @param {string|object} options - The unique ID as a string or a filter object.
 * @returns {Promise<object|null>} - A promise that resolves to the fetched break record or null if not found.
 * @throws {Error} Throws an error if the input is invalid or a network error occurs.
 */
async function fetchOne(options) {
  try {
    let response;
    if (typeof options === 'object' && options !== null) {
      response = await axios.get(`/breaks/findOne`, {
        params: { filter: options },
      });
      return response.data;
    } else if (typeof options === 'string' && isUUID(options)) {
      response = await axios.get(`/breaks/${options}`);
      return response.data;
    } else {
      throw new Error('Invalid params: Please provide a valid filter object or a UUID string.');
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    } else if (error.message.includes('Invalid params')) {
      throw error;
    } else {
      throw new Error('Error getting break record from ATP: ' + error.message);
    }
  }
}

/**
 * Fetches all break records from the ATP API.
 * Optionally accepts a filter object to narrow results.
 * @param {object} [filter] - A filter object to match specific criteria (e.g. { userId: '...' }).
 * @returns {Promise<Array>} A promise that resolves to an array of break records.
 * @throws {Error} If a network error occurs.
 */
async function fetchAll(filter) {
  try {
    const response = await axios.get(`/breaks`, {
      params: filter ? { filter } : {},
    });
    return response.data;
  } catch (error) {
    throw new Error('Error fetching break records from ATP: ' + error.message);
  }
}

async function update(id, data) {
  try {
    const response = await axios.patch(`/breaks/${id}`, data);
    return response.data;
  } catch (error) {
    logger.error({ error }, 'ATP Update Error');
    throw new Error('Error updating break record in ATP');
  }
}

module.exports = {
  create,
  fetchOne,
  fetchAll,
  update,
};
