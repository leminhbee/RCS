const axios = require('axios');
const AVA_URL = process.env.AVA_URL;

const post = async (title, body, createdByName, files) => {
  try {
    const { data } = await axios.post(
      `${AVA_URL}/announcements`,
      { title, body, createdByName, files: Array.isArray(files) ? files : [] },
      {
        maxBodyLength: 30 * 1024 * 1024,
        maxContentLength: 30 * 1024 * 1024,
        // Bounded so a slow or wedged Slack upload can't hold the poster's
        // request open indefinitely.
        timeout: 45000,
      }
    );
    return data;
  } catch (error) {
    // Carry the upstream status and any server-supplied detail. The bare axios
    // message ('Request failed with status code 413') hides which side rejected
    // the payload and why.
    const status = error.response && error.response.status;
    const data = error.response && error.response.data;
    let detail = '';
    if (typeof data === 'string') detail = data.slice(0, 200);
    else if (data) detail = data.error || data.message || '';
    let message = 'Error posting announcement to Slack channel: ' + error.message;
    if (status) message += ` (HTTP ${status}${detail ? ': ' + detail : ''})`;
    throw new Error(message);
  }
};

module.exports = { post };
