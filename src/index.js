require('dotenv').config();
const { createLogger } = require('./helpers/logger');
const { createAppLog, formatError } = require('./helpers/log_schema');
const logger = createLogger();
const express = require('express');
const atp = require('./ATP');
const { v4: uuidv4 } = require('uuid');
const { Mutex } = require('async-mutex');
const xmlparser = require('express-xml-bodyparser');
const http = require('http');
const { recoverWrapUps } = require('./helpers/wrapup_timers');
const { recoverCallbackTimers } = require('./helpers/callback_timers');
const websocket = require('./helpers/websocket');

// --- Configuration ---
const app = express();
app.set('trust proxy', 1); // Trust reverse proxy (nginx) for secure cookies
const PORT = process.env.PORT || 3005;
const mutex = new Mutex();

// --- Body parsers ---
// JSON
app.use(express.json());
// text/json (some webhooks may send JSON but with text/json header)
app.use(express.text({ type: 'text/json' }));
// XML (parse into JS object)
app.use(xmlparser({ explicitArray: false, type: ['application/xml', 'text/xml'] }));

// -- Session --
const sessionMiddleware = require('./auth/session');
app.use(sessionMiddleware);

// -- Auth routes (login/callback/logout - no auth required) --
app.use('/auth', require('./routes/auth'));

// -- Dashboard (before mutex - read-only, bypasses webhook processing) --
const path = require('path');
const dashboardRouter = require('./routes/dashboard');
const requireAuth = require('./auth/authMiddleware');
app.use('/dashboard', requireAuth, express.static(path.join(__dirname, '../public')));
app.use('/dashboard', requireAuth, dashboardRouter);
app.get('/', (req, res) => res.redirect('/dashboard'));

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
          'dashboard_key': req.headers['dashboard_key'],
        },
        body: req.body,
      },
    })
  );

  next();
});

// -- Find Call Record Middleware --
app.use(async (req, res, next) => {
  const callId = req.body.call_id;

  if (!callId) {
    req.callRecord = null;
    return next();
  }

  try {
    const callRecord = await atp.calls.fetchOne({ callId });

    if (callRecord) {
      req.callRecord = callRecord;
    } else {
      // No record found by call_id — check for a callback in progress with this caller number
      // Check both CALLBACK_REQUESTED and RINGING, since the ringing handler may have already updated the status
      const callerNumber = req.body.ani;
      if (callerNumber) {
        const callbackRecord = await atp.calls.fetchOne({ callerNumber, status: 'CALLBACK_REQUESTED' })
          || await atp.calls.fetchOne({ callerNumber, status: 'RINGING' });
        req.callRecord = callbackRecord || null;
      } else {
        req.callRecord = null;
      }
    }
  } catch (error) {
    logger.error({ error, callId, messageId: req.messageId }, 'Error finding call record in middleware');
    req.callRecord = null;
  }

  next();
});

// --- Middleware function ---
const alulaUserMiddleware = async (req, res, next) => {
  try {
    if (req.body.event_type && !req.body.event_aux_type) {
      req.body.event_aux_type = req.body.event_type;
    }

    const agentId = req.body.agent_id;

    // Try to find user by agent_id first, fall back to call record's userId
    if (agentId) {
      req.body.alulaUser = await atp.users.fetchOne({ rcId: agentId });
    }

    if (!req.body.alulaUser && req.callRecord?.userId) {
      req.body.alulaUser = await atp.users.fetchOne(req.callRecord.userId);
    }

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
const server = http.createServer(app);
websocket.init(server, sessionMiddleware);

server.listen(PORT, async () => {
  logger.info(
    createAppLog({
      operation: 'startup',
      data: {
        port: PORT,
        message: 'Webhook server is listening',
      },
    })
  );

  // Recover any active wrap-up timers from before restart
  try {
    await recoverWrapUps(logger);
  } catch (error) {
    logger.error({
      ...createAppLog({ operation: 'wrapup_recovery' }),
      ...formatError(error),
    });
  }

  // Recover any callback timers (if an agent is available and a callback is next in queue)
  try {
    await recoverCallbackTimers(logger);
  } catch (error) {
    logger.error({
      ...createAppLog({ operation: 'callback_recovery' }),
      ...formatError(error),
    });
  }
});
