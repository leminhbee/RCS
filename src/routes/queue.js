const router = require('express').Router();
const queueController = require('../controllers/queue');
const withQueue = require('../helpers/withQueue');

router.post('/new', withQueue(queueController.add));

router.post('/end', withQueue(queueController.remove));

router.post('/callback', withQueue(queueController.callback));

module.exports = router;
