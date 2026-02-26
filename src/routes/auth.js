const router = require('express').Router();
const authController = require('../controllers/auth');

router.get('/login', authController.login);
router.get('/callback', authController.callback);
router.get('/logout', authController.logout);

module.exports = router;
