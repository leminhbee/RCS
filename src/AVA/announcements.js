const axios = require('axios');
const AVA_URL = process.env.AVA_URL;

const post = async (title, body, createdByName) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/announcements`, {
      title,
      body,
      createdByName,
    });
    return data;
  } catch (error) {
    throw new Error('Error posting announcement to Slack canvas: ' + error.message);
  }
};

module.exports = { post };
