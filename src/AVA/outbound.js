const ava = require('./client');

/**
 * Notify AVA of an outbound call so the agent can enter the case number themselves.
 * @param {string} callerNumber - The dnis (outbound number)
 * @param {string} callRecordId - The ATP call record ID
 * @param {string} slackId - The agent's Slack ID
 * @param {string} callRecording - The call recording URL
 */
const notify = async (callerNumber, callRecordId, slackId, callRecording) => {
  const { data } = await ava.post('/outbound/notify', {
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
