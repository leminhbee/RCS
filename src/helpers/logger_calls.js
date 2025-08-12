const pino = require('pino');

const logDestination = '/home/ubuntu/RCS/LOGS/LOGS_CALLS.json';

const transport = pino.transport({
  targets: [
    {
      level: 'info',
      target: 'pino/file',
      options: {
        destination: logDestination,
        translateTime: true, // Enable timestamp formatting
        // Explicitly format in UTC:
        ignoreTimeZone: true,
      },
    },
    {
      level: 'info',
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
  ],
});

const logger = pino(
  {
    errorKey: 'error',
    timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
  },
  transport
);

module.exports = logger;
