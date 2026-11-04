const admin = require('firebase-admin');
const db = admin.firestore();
const redisPublishQueue = require('../utils/redisPublishQueue');
const { validatePublishPayload } = require('../utils/requestValidation');
const { info: logInfo, error: logError } = require('../utils/logger');

function getSocketManager(req) {
    return req.app && req.app.locals && req.app.locals.socketManager;
}

exports.publishPost = async(req, res) => {
    try {
        const validation = validatePublishPayload(req.body);
        if (!validation.valid) return res.status(400).json({ error: validation.errors.join('; ') });

        const { postId } = validation.value;
        const uid = req.user.uid;

        const postSnap = await db.collection('posts').doc(postId).get();
        if (!postSnap.exists) return res.status(404).json({ error: 'Post not found' });

        const postData = postSnap.data();
        if (postData.uid !== uid) return res.status(403).json({ error: 'Unauthorized' });

        const queueItems = await redisPublishQueue.enqueuePosts(uid, [{ id: postId, ...postData }], postData.targets || []);

        const socketManager = getSocketManager(req);
        if (socketManager) {
            socketManager.sendPublishUpdate(uid, postId, 'queued', {
                queueId: queueItems[0].id,
                message: 'Post queued for publishing'
            });
        }

        logInfo(`Post ${postId} queued for publishing by user ${uid}`);
        res.json({ success: true, message: 'Post queued', queueId: queueItems[0].id });
    } catch (error) {
        logError('Publish post error', { error: error.message, uid: req.user.uid });
        res.status(500).json({ error: 'Server error' });
    }
};

exports.retryPublish = async(req, res) => {
    try {
        const { postId, targets } = req.body;
        if (!postId || !Array.isArray(targets) || targets.length === 0) {
            return res.status(400).json({ error: 'postId and targets array required' });
        }

        const uid = req.user.uid;
        const postSnap = await db.collection('posts').doc(postId).get();
        if (!postSnap.exists) return res.status(404).json({ error: 'Post not found' });

        const postData = postSnap.data();
        if (postData.uid !== uid) return res.status(403).json({ error: 'Unauthorized' });

        const retryPostData = { id: postId, ...postData, targets };
        const queueItems = await redisPublishQueue.enqueuePosts(uid, [retryPostData], targets);

        const socketManager = getSocketManager(req);
        if (socketManager) {
            socketManager.sendPublishUpdate(uid, postId, 'retry_queued', {
                queueId: queueItems[0].id,
                message: 'Retry queued'
            });
        }

        res.json({ success: true, message: 'Retry queued', queueId: queueItems[0].id });
    } catch (error) {
        logError('Retry publish error', { error: error.message, uid: req.user.uid });
        res.status(500).json({ error: 'Server error' });
    }
};

exports.getQueueStatus = async(req, res) => {
    try {
        const queueStatus = await redisPublishQueue.getUserActiveJobs(req.user.uid);
        res.json({ queue: queueStatus });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.retryFailed = async(req, res) => {
    try {
        const { postIds } = req.body;
        await redisPublishQueue.retryFailedJobs(req.user.uid, postIds);
        res.json({ success: true, message: `Retrying ${postIds.length} failed posts` });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

exports.cancelJobs = async(req, res) => {
    try {
        const { itemIds } = req.body;
        for (const itemId of itemIds) {
            await redisPublishQueue.cancelJob(req.user.uid, itemId);
        }
        res.json({ success: true, message: `Cancelled ${itemIds.length} items` });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};
