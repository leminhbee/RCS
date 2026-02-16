const router = require('express').Router();
const dashboardController = require('../controllers/dashboard');

router.get('/api', dashboardController.getData);

module.exports = router;
