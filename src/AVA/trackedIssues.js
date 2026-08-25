const axios = require('axios');
const AVA_URL = process.env.AVA_URL;

const post = async (payload) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/tracked-issues`, payload);
    return data;
  } catch (error) {
    throw new Error('Error posting tracked issue to Slack canvas: ' + error.message);
  }
};

// Deletes all canvas sections that make up a single tracked issue block.
// Accepts either the new mapping object ({all, fields}) or a legacy flat array.
const destroySections = async (canvasSectionId) => {
  let ids = [];
  if (Array.isArray(canvasSectionId)) ids = canvasSectionId;
  else if (canvasSectionId && typeof canvasSectionId === 'object') {
    if (Array.isArray(canvasSectionId.all) && canvasSectionId.all.length) ids = canvasSectionId.all;
    else if (canvasSectionId.fields && typeof canvasSectionId.fields === 'object') ids = Object.values(canvasSectionId.fields);
  } else if (typeof canvasSectionId === 'string' && canvasSectionId) {
    ids = [canvasSectionId];
  }
  if (!ids.length) return { ok: false, error: 'no sectionIds provided' };
  const joined = ids.map(encodeURIComponent).join(',');
  try {
    const { data } = await axios.delete(`${AVA_URL}/tracked-issues/sections/${joined}`);
    return data;
  } catch (error) {
    throw new Error('Error deleting tracked issue sections from Slack canvas: ' + error.message);
  }
};

const patch = async (mapping, updates) => {
  try {
    const { data } = await axios.patch(`${AVA_URL}/tracked-issues/canvas`, { mapping, updates });
    return data;
  } catch (error) {
    throw new Error('Error patching tracked issue in Slack canvas: ' + error.message);
  }
};

module.exports = { post, destroySections, patch };
