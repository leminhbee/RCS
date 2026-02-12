const router = require('express').Router();
const chatsController = require('../controllers/chats');
const withQueue = require('../helpers/withQueue');

router.post('/new', withQueue(chatsController.newChat));

router.post('/notify', withQueue(chatsController.notify));

module.exports = router;
