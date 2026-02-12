const ava = require('../AVA');
const { createQueueLog, formatError } = require('../helpers/log_schema');

const add = async (req) => {
  const { messageId, body, logger } = req;
  const callerNumber = body.caller_number;

  try {
    await ava.queue.add(callerNumber, messageId);

    logger.info(
      createQueueLog({
        operation: 'add',
        callerNumber,
        messageId,
        data: {
          source: 'queue_endpoint',
          body,
        },
      })
    );
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

const remove = async (req) => {
  const { messageId, body, logger } = req;
  const callerNumber = body.caller_number;

  try {
    if (body.call_result === 'ABANDON' || body.recording_url === '') {

      await ava.queue.remove(callerNumber, messageId, body.call_result, body);

      logger.info(
        createQueueLog({
          operation: 'remove',
          callerNumber,
          messageId,
          data: {
            reason: body.call_result,
            hasRecording: body.recording_url.length > 0,
            body,
          },
        })
      );
    }
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

const callback = async (req) => {
  const { messageId, body, logger } = req;
  const callerNumber = body.caller_number;

  try {
    await ava.queue.add(callerNumber, messageId);

    logger.info(
      createQueueLog({
        operation: 'callback',
        callerNumber,
        messageId,
        data: {
          source: 'callback_endpoint',
          body,
        },
      })
    );
  } catch (error) {
    logger.error({
      ...createQueueLog({
        operation: 'callback',
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
  callback
};
