require('dotenv').config();
const { createLogger } = require('./helpers/logger');
const { createAppLog, formatError } = require('./helpers/log_schema');
const logger = createLogger();
const express = require('express');
const atp = require('./ATP');
const { v4: uuidv4 } = require('uuid');
const { Mutex } = require('async-mutex');
const xmlparser = require('express-xml-bodyparser');

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3005;
const mutex = new Mutex();

// --- Body parsers ---
// JSON
app.use(express.json());
// text/json (some webhooks may send JSON but with text/json header)
app.use(express.text({ type: 'text/json' }));
// XML (parse into JS object)
app.use(xmlparser({ explicitArray: false, type: ['application/xml', 'text/xml'] }));

// -- Message ID Middleware --
app.use((req, res, next) => {
  req.messageId = uuidv4();
  res.status(200).send('Ok');
  mutex.acquire().then((release) => {
    req.done = release;
    next();
  });
});

// -- Request Logging Middleware (logs ALL incoming requests) --
app.use((req, res, next) => {
  if (typeof req.body === 'string') {
    req.body = JSON.parse(req.body);
  }

  logger.info(
    createAppLog({
      operation: 'request_received',
      messageId: req.messageId,
      data: {
        url: req.originalUrl,
        method: req.method,
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
        },
        body: req.body,
      },
    })
  );
  next();
});

// --- Middleware function ---
const alulaUserMiddleware = async (req, res, next) => {
  try {
    const supervisors = ['861', '1230'];

    if (req.body.event_type && !req.body.event_aux_type) {
      req.body.event_aux_type = req.body.event_type;
    }

    const agentId = req.body.agent_id;

    if (supervisors.includes(agentId)) {
      req.body.isSupervisor = true;
      req.body.alulaUser = null;
      return next();
    }

    req.body.alulaUser = await atp.users.fetchOne({ rcId: agentId });

    if (req.body.alulaUser) {
      next();
    } else {
      logger.warn({
        ...createAppLog({
          operation: 'middleware',
          subOperation: 'USER_NOT_FOUND',
          messageId: req.messageId,
          data: {
            agentId,
            url: req.originalUrl,
          },
        }),
      });
      if (req.done) req.done();
    }
  } catch (error) {
    logger.error({
      ...createAppLog({
        operation: 'middleware',
        subOperation: 'HTTP_ERROR',
        messageId: req.messageId,
        data: {
          url: req.originalUrl,
        },
      }),
      ...formatError(error),
    });
    if (req.done) req.done();
  }
};

// -- Route Loggers --
const routeLoggers = {
  calls: createLogger('calls'),
  chats: createLogger('chats'),
  statuses: createLogger('statuses'),
  cases: createLogger('cases'),
  queue: createLogger('queue'),
};

const attachLogger = (domain) => (req, res, next) => {
  req.logger = routeLoggers[domain].child({ url: req.originalUrl });
  next();
};

// -- Load Routes --
const callsRouter = require('./routes/calls');
const chatsRouter = require('./routes/chats');
const statusesRouter = require('./routes/statuses');
const casesRouter = require('./routes/cases');
const queueRouter = require('./routes/queue');

// -- Mount Routes with middleware where needed --
app.use('/calls', attachLogger('calls'), alulaUserMiddleware, callsRouter);
app.use('/chats', attachLogger('chats'), alulaUserMiddleware, chatsRouter);
app.use('/statuses', attachLogger('statuses'), alulaUserMiddleware, statusesRouter);
app.use('/cases', attachLogger('cases'), casesRouter);
app.use('/queue', attachLogger('queue'), queueRouter);

// -- Catch-all: release mutex lock for unmatched routes --
app.use((req, res, next) => {
  if (req.done) req.done();
});

// --- Start Server ---
app.listen(PORT, () => {
  logger.info(
    createAppLog({
      operation: 'startup',
      data: {
        port: PORT,
        message: 'Webhook server is listening',
      },
    })
  );
});
