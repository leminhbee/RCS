const axios = require('axios');
const atp_url = process.env.ATP_URL;
const { validate: isUUID } = require('uuid'); // Import the UUID validation function

/**
 * Fetches a user record from the ATP API.
 * The function accepts a single 'params' parameter which can be one of two types:
 * - A string: A valid UUID to fetch a user record by its unique ID.
 * - An object: A filter object to find a user record that matches specific criteria.
 * @param {string|object} params - The unique ID as a string or a filter object.
 * @returns {Promise<object|null>} A promise that resolves to the fetched user data or null if not found.
 * @throws {Error} If the provided `params` are invalid or a network error occurs.
 */
async function fetchOne(params) {
  try {
    let response;
    if (typeof params === 'object' && params !== null) {
      // Use the findOne endpoint for filter-based searches.
      response = await axios.get(`${atp_url}/users/findOne`, {
        params: { filter: params },
      });
      // The API returns null for no results, so we can directly return the data.
      return response.data;
    } else if (typeof params === 'string' && isUUID(params)) {
      // Use the specific ID endpoint for UUID-based searches.
      response = await axios.get(`${atp_url}/users/${params}`);
      // The API returns the user object if found.
      return response.data;
    } else {
      throw new Error('Invalid params: Please provide a valid filter object or a UUID string.');
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // If the API returns a 404 (for a specific ID not found), return null.
      return null;
    } else if (error.message.includes('Invalid params')) {
      // Rethrow the custom error for invalid input.
      throw error;
    } else {
      // Throw a generic error for network or unexpected issues.
      throw new Error('Error getting user record from ATP: ' + error.message);
    }
  }
}

async function fetchAll() {
  try {
    const response = await axios.get(`${atp_url}/users`);
    return response.data;
  } catch (error) {
    throw new Error('Error inserting break start: ' + error.message);
  }
}

module.exports = {
  fetchOne,
  fetchAll,
};
