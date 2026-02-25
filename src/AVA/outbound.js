const axios = require('axios');
const AVA_URL = process.env.AVA_URL;

/**
 * Notify AVA of an outbound call so the agent can enter the case number themselves.
 * @param {string} callerNumber - The dnis (outbound number)
 * @param {string} callRecordId - The ATP call record ID
 * @param {string} slackId - The agent's Slack ID
 * @param {string} callRecording - The call recording URL
 */
const notify = async (callerNumber, callRecordId, slackId, callRecording) => {
  const { data } = await axios.post(`${AVA_URL}/outbound/notify`, {
    callerNumber,
    callRecordId,
    slackId,
    callRecording,
  });
  return data;
};

module.exports = {
  notify,
};
