const ava = require('./client');

const breakEnding = async (slackId, remainingTime) => {
  try {
    const { data } = await ava.post('/notifications/breakEnding', {
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
    const { data } = await ava.post('/notifications/late', {
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
    const { data } = await ava.post('/notifications/', {
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
    const { data } = await ava.post('/notifications/callbackFailed', {
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
