const pino = require('pino');
const path = require('path');

const LOG_DIR = '/home/ubuntu/RCS/LOGS';

// Factory for one-off scripts (anything in scripts/). Auto-derives the
// destination file name from the running script's basename:
//   node scripts/backfill_jive_urls.js → LOGS_BACKFILL_JIVE_URLS.json
const createScriptLogger = () => {
  const scriptName = path.basename(require.main?.filename || 'script', '.js').toUpperCase();

  const transport = pino.transport({
    targets: [
      {
        level: 'info',
        target: 'pino/file',
        options: {
          destination: `${LOG_DIR}/LOGS_${scriptName}.json`,
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
      base: { script: scriptName },
    },
    transport
  );
};

module.exports = { createScriptLogger };
