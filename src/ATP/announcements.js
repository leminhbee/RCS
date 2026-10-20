const axios = require('./client');
const { validate: isUUID } = require('uuid');

async function create({ title, body, createdBy }) {
  try {
    const response = await axios.post('/announcements', { title, body, createdBy });
    return response.data;
  } catch (error) {
    throw new Error('Error creating announcement in ATP: ' + error.message);
  }
}

async function fetchAll(filter) {
  try {
    const response = await axios.get('/announcements', {
      params: filter ? { filter } : {},
    });
    return response.data;
  } catch (error) {
    throw new Error('Error fetching announcements from ATP: ' + error.message);
  }
}

async function fetchOne(id) {
  if (typeof id !== 'string' || !isUUID(id)) {
    throw new Error('Invalid params: announcement id must be a UUID string.');
  }
  try {
    const response = await axios.get(`/announcements/${id}`);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) return null;
    throw new Error('Error fetching announcement from ATP: ' + error.message);
  }
}

async function update(id, data) {
  try {
    const response = await axios.patch(`/announcements/${id}`, data);
    return response.data;
  } catch (error) {
    throw new Error('Error updating announcement in ATP: ' + error.message);
  }
}

async function destroy(id) {
  try {
    const response = await axios.delete(`/announcements/${id}`);
    return response.data;
  } catch (error) {
    // Carry the upstream status so a caller can distinguish an already-deleted
    // row (404) from a real failure.
    const err = new Error('Error deleting announcement from ATP: ' + error.message);
    err.status = error.response && error.response.status;
    throw err;
  }
}

async function acknowledge(id, userId) {
  try {
    const response = await axios.post(`/announcements/${id}/acks`, { userId });
    return response.data;
  } catch (error) {
    throw new Error('Error acknowledging announcement in ATP: ' + error.message);
  }
}

async function fetchAcks(id) {
  try {
    const response = await axios.get(`/announcements/${id}/acks`);
    return response.data;
  } catch (error) {
    throw new Error('Error fetching announcement acks from ATP: ' + error.message);
  }
}

module.exports = {
  create,
  fetchAll,
  fetchOne,
  update,
  destroy,
  acknowledge,
  fetchAcks,
};
