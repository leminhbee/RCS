const axios = require('axios');
const { createLogger } = require('../helpers/logger');
const { createQueueLog, formatError } = require('../helpers/log_schema');
const logger = createLogger('queue');

const AVA_URL = process.env.AVA_URL;

/**
 * Add caller to AVA queue
 * @param {string} callerNumber - Phone number (for logging)
 * @param {string} [messageId] - Optional correlation ID
 */
const add = async (callerNumber, messageId) => {
  try {
    const results = await axios.post(`${AVA_URL}/queue/add`);

    logger.info(
      createQueueLog({
        operation: 'add',
        callerNumber,
        messageId,
        data: {
          avaResponse: results.data,
          timestamp: date.toISOString(),
        },
      })
    );

    return results;
  } catch (error) {
    logger.error({
      ...createQueueLog({
        operation: 'add',
        callerNumber,
        messageId,
      }),
      ...formatError(error),
    });
    throw new Error('Error adding to queue: ' + error.message);
  }
};

/**
 * Remove caller from AVA queue
 * @param {string} callerNumber - Phone number (for logging)
 * @param {string} [messageId] - Optional correlation ID
 * @param {string} [reason] - Optional reason for removal
 * @param {Object} [body] - Optional request body for logging
 */
const remove = async (callerNumber, messageId, reason, body) => {
  try {
    const results = await axios.post(`${AVA_URL}/queue/remove`);

    logger.info(
      createQueueLog({
        operation: 'remove',
        callerNumber,
        messageId,
        data: {
          avaResponse: results.data,
          timestamp: date.toISOString(),
          ...(reason && { reason }),
          ...(body && { body }),
        },
      })
    );

    return results;
  } catch (error) {
    logger.error({
      ...createQueueLog({
        operation: 'remove',
        callerNumber,
        messageId,
      }),
      ...formatError(error),
    });
    throw new Error('Error removing from queue: ' + error.message);
  }
};

module.exports = {
  add,
  remove,
};
