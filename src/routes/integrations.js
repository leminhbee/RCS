const router = require('express').Router();
const statusesController = require('../controllers/statuses');
const callsController = require('../controllers/calls');

router.post('/statuses', statusesController);

router.post('/calls/answer', callsController.answer);

router.post('/calls/end', callsController.end);

module.exports = router;
