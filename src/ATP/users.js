const axios = require('axios');
const atp_url = process.env.ATP_URL;
const { validate: isUUID } = require('uuid'); // Import the UUID validation function

/**
 * Fetches a user record from the ATP API.
 *
 * @async
 * @function getUser
 * @param {(object|string)} params - The parameters for fetching the user.
 * @param {object} [params.filter] - A filter object to search for users (e.g., { email: 'example@email.com' }).
 * @param {string} [params] - A UUID string representing the user's ID.
 * @returns {Promise<object>} A promise that resolves with the user data.
 * @throws {Error} If an error occurs while fetching the user from the ATP API.
 * @throws {Error} If the provided `params` are invalid (not a valid filter object or UUID string).
 * @throws {Error} If the user is not found (404 error from the API).
 */
async function fetchOne(params) {
  try {
    let response;
    if (typeof params === 'object' && params !== null) {
      response = await axios.get(`${atp_url}/users/findOne`, {
        params: { filter: params },
      });
    } else if (typeof params === 'string' && isUUID(params)) {
      // Validate if it's a UUID
      response = await axios.get(`${atp_url}/users/${params}`);
    } else {
      throw new Error('Invalid params: Please provide a valid filter object or a UUID string.');
    }
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      throw new Error('User not found');
    } else if (error.message.includes('Invalid params')) {
      throw error; // Rethrow the custom error
    } else {
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
