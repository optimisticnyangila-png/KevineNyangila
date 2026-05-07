const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { validatePublishPayload } = require('../utils/requestValidation');
const admin = require('firebase-admin');
const db = admin.firestore();
const { publishToPlatforms } = require('../utils/publishUtils');
const redisPublishQueue = require('../utils/redisPublishQueue');
const { info: logInfo, error: logError } = require('../utils/logger');

const router = express.Router();

function getSocketManager(req) {
    return req.app && req.app.locals && req.app.locals.socketManager;
}

router.post('/', authMiddleware, async(req, res) => {
    try {
        const validation = validatePublishPayload(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join('; ') });
        }

        const { postId } = validation.value;
        const uid = req.user && req.user.uid;
        if (!uid) {
            return res.status(401).json({ error: 'Unauthorized: missing user identity' });
        }

        const postSnap = await db.collection('posts').doc(postId).get();
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const postData = postSnap.data();
        if (postData.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Use Redis queue system for better reliability and real-time updates
        const queueItems = await redisPublishQueue.enqueuePosts(uid, [postData], postData.targets || []);

        // Send real-time update
        const socketManager = getSocketManager(req);
        if (socketManager) {
            socketManager.sendPublishUpdate(uid, postId, 'queued', {
                queueId: queueItems[0].id,
                message: 'Post queued for publishing'
            });
        }

        logInfo(`Post ${postId} queued for publishing by user ${uid}`);
        res.json({
            success: true,
            message: 'Post queued for publishing',
            queueId: queueItems[0].id
        });
    } catch (error) {
        logError('Publish post error', { error: error.message, uid: req.user ?.uid });
        res.status(500).json({ error: 'Server error' });
    }
});

// Retry publishing to specific failed accounts
router.post('/retry', authMiddleware, async(req, res) => {
    try {
        const { postId, targets } = req.body;
        if (!postId || !Array.isArray(targets) || targets.length === 0) {
            return res.status(400).json({ error: 'postId and targets array required' });
        }

        const uid = req.user && req.user.uid;
        if (!uid) {
            return res.status(401).json({ error: 'Unauthorized: missing user identity' });
        }

        const postSnap = await db.collection('posts').doc(postId).get();
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const postData = postSnap.data();
        if (postData.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        // Use Redis queue system for retry
        const retryPostData = {...postData, targets };
        const queueItems = await redisPublishQueue.enqueuePosts(uid, [retryPostData], targets);

        // Send real-time update
        const socketManager = getSocketManager(req);
        if (socketManager) {
            socketManager.sendPublishUpdate(uid, postId, 'retry_queued', {
                queueId: queueItems[0].id,
                message: 'Retry queued for failed targets'
            });
        }

        logInfo(`Retry queued for post ${postId} by user ${uid}`);
        res.json({
            success: true,
            message: 'Retry queued for failed targets',
            queueId: queueItems[0].id
        });
    } catch (error) {
        logError('Retry publish error', { error: error.message, uid: req.user ?.uid });
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user's publish queue status
router.get('/queue', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const queueStatus = await redisPublishQueue.getUserActiveJobs(uid);
        res.json({ queue: queueStatus });
    } catch (error) {
        logError('Get queue status error', { error: error.message, uid: req.user ?.uid });
        res.status(500).json({ error: 'Server error' });
    }
});

// Retry failed posts
router.post('/retry-failed', authMiddleware, async(req, res) => {
    try {
        const { postIds } = req.body;
        if (!Array.isArray(postIds) || postIds.length === 0) {
            return res.status(400).json({ error: 'postIds array required' });
        }

        const uid = req.user.uid;
        await redisPublishQueue.retryFailedJobs(uid, postIds);

        // Send real-time update
        const socketManager = getSocketManager(req);
        if (socketManager) {
            socketManager.sendQueueUpdate(uid, {
                action: 'retry_failed',
                postIds,
                message: `Retrying ${postIds.length} failed posts`
            });
        }

        logInfo(`User ${uid} requested retry for ${postIds.length} failed posts`);
        res.json({ success: true, message: `Retrying ${postIds.length} failed posts` });
    } catch (error) {
        logError('Retry failed posts error', { error: error.message, uid: req.user ?.uid });
        res.status(500).json({ error: 'Server error' });
    }
});

// Cancel queued items
router.post('/cancel', authMiddleware, async(req, res) => {
    try {
        const { itemIds } = req.body;
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
            return res.status(400).json({ error: 'itemIds array required' });
        }

        const uid = req.user.uid;
        for (const itemId of itemIds) {
            await redisPublishQueue.cancelJob(uid, itemId);
        }

        // Send real-time update
        const socketManager = getSocketManager(req);
        if (socketManager) {
            socketManager.sendQueueUpdate(uid, {
                action: 'cancelled',
                itemIds,
                message: `Cancelled ${itemIds.length} queue items`
            });
        }

        logInfo(`User ${uid} cancelled ${itemIds.length} queue items`);
        res.json({ success: true, message: `Cancelled ${itemIds.length} queue items` });
    } catch (error) {
        logError('Cancel queue items error', { error: error.message, uid: req.user ?.uid });
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
