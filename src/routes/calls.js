const router = require('express').Router();
const callsController = require('../controllers/calls');
const withQueue = require('../helpers/withQueue');

router.post('/answer', withQueue(callsController.answer));

router.post('/end', withQueue(callsController.end));

module.exports = router;
