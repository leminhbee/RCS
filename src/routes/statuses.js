const router = require('express').Router();
const statusesController = require('../controllers/statuses');
const withQueue = require('../helpers/withQueue');

router.post('/', withQueue(statusesController));

module.exports = router;
