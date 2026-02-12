const ava = require('../AVA');

const newChat = (req) => {
  req.logger.info(req);
};

const notify = (req) => {
  req.logger.info(req);
};

module.exports = {
  newChat,
  notify,
};
