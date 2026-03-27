const axios = require('axios');
const atp_url = process.env.ATP_URL;
const { validate: isUUID } = require('uuid');

async function create(options) {
  try {
    const response = await axios.post(`${atp_url}/settings`, options);
    return response.data;
  } catch (error) {
    throw new Error('Error writing new setting to database: ' + error.message);
  }
}

async function fetchOne(options) {
  try {
    let response;
    if (typeof options === 'object' && options !== null) {
      response = await axios.get(`${atp_url}/settings/findOne`, {
        params: { filter: options },
      });
      return response.data;
    } else if (typeof options === 'string' && isUUID(options)) {
      response = await axios.get(`${atp_url}/settings/${options}`);
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
      throw new Error('Error getting setting from ATP: ' + error.message);
    }
  }
}

async function update(id, data) {
  try {
    const response = await axios.patch(`${atp_url}/settings/${id}`, data);
    return response.data;
  } catch (error) {
    throw new Error('Error updating setting in ATP: ' + error.message);
  }
}

async function destroy(id) {
  try {
    const response = await axios.delete(`${atp_url}/settings/${id}`);
    return response.data;
  } catch (error) {
    throw new Error('Error deleting setting from ATP: ' + error.message);
  }
}

module.exports = {
  create,
  fetchOne,
  update,
  destroy,
};
