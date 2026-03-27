const axios = require('axios');
const qs = require('qs');

const atpClient = axios.create({
  baseURL: process.env.ATP_URL,
  paramsSerializer: (params) => qs.stringify(params, { encode: false }),
});

module.exports = atpClient;
