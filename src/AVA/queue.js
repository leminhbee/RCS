const ava = require('./client');
const { createLogger } = require('../helpers/logger');
const { createQueueLog, formatError } = require('../helpers/log_schema');
const logger = createLogger('queue');


/**
 * Add caller to AVA queue
 * @param {string} callerNumber - Phone number (for logging)
 * @param {string} [messageId] - Optional correlation ID
 */
const add = async (callerNumber, messageId) => {
  try {
    const results = await ava.post('/queue/add');

    logger.info(
      createQueueLog({
        operation: 'add',
        callerNumber,
        messageId,
        data: {
          avaResponse: results.data,
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
    const results = await ava.post('/queue/remove');

    logger.info(
      createQueueLog({
        operation: 'remove',
        callerNumber,
        messageId,
        data: {
          avaResponse: results.data,
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
  }
};

module.exports = {
  add,
  remove,
};
