const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const publishController = require('../controllers/publishController');

const router = express.Router();

router.post('/', authMiddleware, publishController.publishPost);
router.post('/retry', authMiddleware, publishController.retryPublish);
router.get('/queue', authMiddleware, publishController.getQueueStatus);
router.post('/retry-failed', authMiddleware, publishController.retryFailed);
router.post('/cancel', authMiddleware, publishController.cancelJobs);

module.exports = router;
