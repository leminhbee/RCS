const { broadcast } = require('./websocket');

const withQueue = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
    await broadcast();
  } finally {
    if (req.done) req.done();
  }
};

module.exports = withQueue;
