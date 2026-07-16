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

module.exports = { post };
