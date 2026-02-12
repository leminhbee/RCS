const withQueue = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } finally {
    if (req.done) req.done();
  }
};

module.exports = withQueue;
