const axios = require('./client');
const { validate: isUUID } = require('uuid');

async function create(payload) {
  try {
    const response = await axios.post('/tracked-issues', payload);
    return response.data;
  } catch (error) {
    throw new Error('Error creating tracked issue in ATP: ' + error.message);
  }
}

async function fetchAll(filter) {
  try {
    const response = await axios.get('/tracked-issues', {
      params: filter ? { filter } : {},
    });
    return response.data;
  } catch (error) {
    throw new Error('Error fetching tracked issues from ATP: ' + error.message);
  }
}

async function fetchOne(id) {
  if (typeof id !== 'string' || !isUUID(id)) {
    throw new Error('Invalid params: tracked issue id must be a UUID string.');
  }
  try {
    const response = await axios.get(`/tracked-issues/${id}`);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) return null;
    throw new Error('Error fetching tracked issue from ATP: ' + error.message);
  }
}

async function update(id, data) {
  try {
    const response = await axios.patch(`/tracked-issues/${id}`, data);
    return response.data;
  } catch (error) {
    throw new Error('Error updating tracked issue in ATP: ' + error.message);
  }
}

async function destroy(id) {
  try {
    const response = await axios.delete(`/tracked-issues/${id}`);
    return response.data;
  } catch (error) {
    throw new Error('Error deleting tracked issue from ATP: ' + error.message);
  }
}

module.exports = { create, fetchAll, fetchOne, update, destroy };
