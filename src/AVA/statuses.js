const axios = require('axios');
const AVA_URL = process.env.AVA_URL;

const update = async (params) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/statuses/update`, params);
    return data;
  } catch (error) {
    throw new Error('Error updating slack status: ' + error.message);
  }
};

module.exports = {
  update,
};
