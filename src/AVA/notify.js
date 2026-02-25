const axios = require('axios');
const AVA_URL = process.env.AVA_URL;

const breakEnding = async (slackId, remainingTime) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/notifications/breakEnding`, {
      slackId,
      remainingTime,
    });
    return data;
  } catch (error) {
    throw new Error('Error notifying user of ending break: ' + error.message);
  }
};

const late = async (slackId, userName, timeOver) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/notifications/late`, {
      slackId,
      userName,
      timeOver,
    });
    return data;
  } catch (error) {
    throw new Error('Error notifying admins about late: ' + error.message);
  }
};

const newChat = async (slackId, userName, timeOver) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/notifications/`, {
      slackId,
      userName,
      timeOver,
    });
    return data;
  } catch (error) {
    throw new Error('Error notifying admins about late: ' + error.message);
  }
};

const callbackFailed = async (callerNumber, callerName, companyName) => {
  try {
    const { data } = await axios.post(`${AVA_URL}/notifications/callbackFailed`, {
      callerNumber,
      callerName,
      companyName,
    });
    return data;
  } catch (error) {
    throw new Error('Error notifying of failed callback: ' + error.message);
  }
};

module.exports = {
  breakEnding,
  late,
  callbackFailed,
};
