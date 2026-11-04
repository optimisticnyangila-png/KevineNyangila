const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const postController = require('../controllers/postController');

const router = express.Router();

router.post('/', authMiddleware, postController.schedulePost);
router.get('/', authMiddleware, postController.getScheduledPosts);
router.delete('/:postId', authMiddleware, postController.unschedulePost);

module.exports = router;
