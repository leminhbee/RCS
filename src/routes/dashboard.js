const router = require('express').Router();
const dashboardController = require('../controllers/dashboard');

router.get('/api', dashboardController.getData);
router.delete('/api/queue/:id', dashboardController.removeQueueCall);


module.exports = router;
