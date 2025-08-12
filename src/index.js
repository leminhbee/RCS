require('dotenv').config();
const logger = require('./helpers/logger');
const express = require('express');
const atp = require('./ATP');

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.text({ type: 'text/json' }), express.json());

// -- Middle wear to parse JSON from body and retrieve the alula user
app.use(async (req, res, next) => {
  try {
    res.status(200).send('Ok');
    
    const supervisors = [
      '861',
    ];

    if (typeof req.body === 'string') {
      req.body = JSON.parse(req.body);
    }

    if (req.body.event_type && !req.body.event_aux_type) {
      req.body.event_aux_type = req.body.event_type;
    }
    const agentId = req.body.agent_id;

    if (supervisors.includes(agentId)) {
      return;
    };

    req.body.alulaUser = await atp.users.fetchOne({ rcId: agentId })
      .catch(error => {
        if (error.message === 'User not found') {
          logger.error({ requestBody: req.body }, 'User not found');
          return null;
        } else {
          throw error;
        }
      });
    if (req.body.alulaUser) next();
  } catch (error) {
    logger.error({ error }, 'Error with HTTP request')
  }
});
// -- Load Routes --
const integrationsRouter = require('./routes/integrations');

// -- Mount Routes --
app.use('/integrations', integrationsRouter);

// --- Start Server ---
app.listen(PORT, () => {
  logger.info(`Webhook server is listening on port ${PORT}`);
});
