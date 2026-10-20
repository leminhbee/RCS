const ava = require('./client');

const update = async (params) => {
  try {
    const { data } = await ava.post('/statuses/update', params);
    return data;
  } catch (error) {
    throw new Error('Error updating slack status: ' + error.message);
  }
};

module.exports = {
  update,
};
