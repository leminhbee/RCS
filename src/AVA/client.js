const axios = require('axios');
const { createLogger } = require('../helpers/logger');

const logger = createLogger('ava-client');

const AVA_URL = process.env.AVA_URL;
const AVA_SERVICE_KEY = process.env.AVA_SERVICE_KEY;

// AVA's HTTP API is published to the public internet by Caddy, and most of
// what RCS calls there acts with the Slack bot's authority. Every request
// therefore carries a service key, which AVA checks in
// src/helpers/service-auth.js. One shared instance so a key rotation is a
// single edit rather than a hunt through every caller.
if (!AVA_SERVICE_KEY) {
  logger.error(
    { event: 'avaClient' },
    'AVA_SERVICE_KEY is not set — calls to AVA will be rejected with 401'
  );
}

const client = axios.create({
  baseURL: AVA_URL,
  headers: AVA_SERVICE_KEY ? { Authorization: `Bearer ${AVA_SERVICE_KEY}` } : {},
});

module.exports = client;
