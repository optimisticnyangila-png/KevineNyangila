const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const postController = require('../controllers/postController');

const router = express.Router();

router.post('/', authMiddleware, postController.createPost);
router.get('/', authMiddleware, postController.getDraftPosts);
router.put('/:postId', authMiddleware, postController.updatePost);
router.delete('/:postId', authMiddleware, postController.deletePost);

module.exports = router;
