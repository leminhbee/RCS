const router = require('express').Router();
const authController = require('../controllers/auth');

router.get('/login', authController.login);
router.post('/login', authController.localLogin);
router.post('/check-email', authController.checkEmail);
router.get('/reset-password', authController.resetPasswordPage);
router.post('/reset-password', authController.resetPassword);
router.get('/change-password', authController.changePasswordPage);
router.get('/callback', authController.callback);
router.get('/logout', authController.logout);

module.exports = router;
