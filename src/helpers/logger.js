const pino = require('pino');

const LOG_DIR = '/home/ubuntu/RCS/LOGS';

// Factory: createLogger('calls') → writes to LOGS_CALLS.json AND LOGS.json
//          createLogger()        → writes to LOGS.json only (general/app)
const createLogger = (domain = 'app') => {
  const targets = [
    {
      level: 'info',
      target: 'pino/file',
      options: {
        destination: `${LOG_DIR}/LOGS.json`,
        translateTime: true,
        ignoreTimeZone: true,
      },
    },
    {
      level: 'error',
      target: 'pino/file',
      options: {
        destination: `${LOG_DIR}/LOGS_ERRORS.json`,
        translateTime: true,
        ignoreTimeZone: true,
      },
    },
  ];

  if (domain !== 'app') {
    targets.push({
      level: 'info',
      target: 'pino/file',
      options: {
        destination: `${LOG_DIR}/LOGS_${domain.toUpperCase()}.json`,
        translateTime: true,
        ignoreTimeZone: true,
      },
    });
  }

  const transport = pino.transport({ targets });

  return pino(
    {
      errorKey: 'error',
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    },
    transport
  );
};

// Console logger for development / testing (pino-pretty)
const createPrettyLogger = () => {
  const transport = pino.transport({
    targets: [
      {
        level: 'info',
        target: 'pino-pretty',
        options: {
          translateTime: true,
          ignoreTimeZone: true,
        },
      },
    ],
  });

  return pino(
    {
      errorKey: 'error',
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    },
    transport
  );
};

module.exports = { createLogger, createPrettyLogger };
