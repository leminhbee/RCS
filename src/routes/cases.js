const router = require('express').Router();
const casesController = require('../controllers/cases');
const withQueue = require('../helpers/withQueue');

router.post('/closed', withQueue(casesController.closed));

module.exports = router;
