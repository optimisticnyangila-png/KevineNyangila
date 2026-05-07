const admin = require('firebase-admin');
const { info: logInfo, error: logError, warn: logWarn } = require('./logger');
const { publishToPlatforms } = require('./publishUtils');
const { checkAccountLimit } = require('../middleware/rateLimiter');

const db = admin.firestore();

// Import socket manager for real-time updates
let socketManager;
try {
    socketManager = require('../server').socketManager;
} catch (e) {
    // Server might not be initialized yet
    socketManager = null;
}

/**
 * Publish Queue System
 * Handles bulk posting, retries, and real-time status updates
 */
class PublishQueue {
    constructor() {
        this.processing = new Set();
        this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_PUBLISHES, 10) || 5;
        this.retryAttempts = parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3;
        this.retryDelayMs = parseInt(process.env.RETRY_DELAY_MS, 10) || 300000; // 5 minutes
    }

    /**
     * Add posts to publish queue
     */
    async enqueuePosts(uid, posts, targets) {
        const batch = db.batch();
        const queueItems = [];

        for (const post of posts) {
            const queueId = `${uid}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const queueItem = {
                id: queueId,
                uid,
                post,
                targets,
                status: 'queued',
                createdAt: new Date(),
                priority: post.priority || 0,
                retryCount: 0,
                lastAttemptAt: null,
                nextRetryAt: null,
                results: {}
            };

            const ref = db.collection('publishQueue').doc(queueId);
            batch.set(ref, queueItem);
            queueItems.push(queueItem);
        }

        await batch.commit();
        logInfo(`Enqueued ${posts.length} posts for user ${uid}`);

        // Start processing
        this.processQueue();

        return queueItems;
    }

    /**
     * Process queued items
     */
    async processQueue() {
        if (this.processing.size >= this.maxConcurrent) {
            return; // Already at max capacity
        }

        try {
            // Get pending items ordered by priority and creation time
            const pendingItems = await db.collection('publishQueue')
                .where('status', 'in', ['queued', 'retry'])
                .where('nextRetryAt', '<=', new Date())
                .orderBy('nextRetryAt')
                .orderBy('priority', 'desc')
                .orderBy('createdAt')
                .limit(this.maxConcurrent - this.processing.size)
                .get();

            for (const doc of pendingItems.docs) {
                const item = doc.data();
                if (this.processing.has(item.id)) continue;

                this.processing.add(item.id);
                this.processItem(item).finally(() => {
                    this.processing.delete(item.id);
                });
            }
        } catch (error) {
            logError('Error processing queue', { error: error.message });
        }
    }

    /**
     * Process a single queue item
     */
    async processItem(item) {
        try {
            logInfo(`Processing queue item ${item.id} for user ${item.uid}`);

            // Send real-time update: processing started
            if (socketManager) {
                socketManager.sendPublishUpdate(item.uid, item.post.id || item.id, 'processing', {
                    queueId: item.id,
                    message: 'Started publishing to platforms'
                });
            }

            // Update status to processing
            await db.collection('publishQueue').doc(item.id).update({
                status: 'processing',
                lastAttemptAt: new Date()
            });

            // Check rate limits for each target
            const validTargets = [];
            for (const target of item.targets) {
                const accountLimit = await checkAccountLimit(item.uid, target.accountId, target.platform);
                if (accountLimit.allowed) {
                    validTargets.push(target);
                } else {
                    item.results[target.id] = {
                        success: false,
                        error: 'Rate limit exceeded',
                        retryAfter: accountLimit.retryAfter
                    };
                }
            }

            if (validTargets.length === 0) {
                await this.markFailed(item.id, 'All targets rate limited');
                if (socketManager) {
                    socketManager.sendPublishUpdate(item.uid, item.post.id || item.id, 'failed', {
                        queueId: item.id,
                        message: 'All targets rate limited',
                        results: item.results
                    });
                }
                return;
            }

            // Publish to valid targets
            const publishResults = await publishToPlatforms(item.post, validTargets);

            // Update results
            Object.assign(item.results, publishResults);

            // Send real-time update with partial results
            if (socketManager) {
                socketManager.sendPublishUpdate(item.uid, item.post.id || item.id, 'progress', {
                    queueId: item.id,
                    message: `Published to ${validTargets.length} platforms`,
                    results: publishResults
                });
            }

            // Check if all targets failed
            const allFailed = Object.values(publishResults).every(result => !result.success);
            if (allFailed && item.retryCount < this.retryAttempts) {
                await this.scheduleRetry(item);
                if (socketManager) {
                    socketManager.sendPublishUpdate(item.uid, item.post.id || item.id, 'retry_scheduled', {
                        queueId: item.id,
                        message: 'All publishes failed, scheduled for retry',
                        retryCount: item.retryCount + 1
                    });
                }
            } else {
                await this.markCompleted(item.id, publishResults);
                if (socketManager) {
                    socketManager.sendPublishUpdate(item.uid, item.post.id || item.id, 'completed', {
                        queueId: item.id,
                        message: 'Publishing completed',
                        results: publishResults
                    });
                }
            }

        } catch (error) {
            logError(`Error processing queue item ${item.id}`, { error: error.message });

            if (socketManager) {
                socketManager.sendPublishUpdate(item.uid, item.post.id || item.id, 'error', {
                    queueId: item.id,
                    message: 'Publishing failed with error',
                    error: error.message
                });
            }

            if (item.retryCount < this.retryAttempts) {
                await this.scheduleRetry(item);
            } else {
                await this.markFailed(item.id, error.message);
            }
        }
    }

    /**
     * Schedule a retry for failed item
     */
    async scheduleRetry(item) {
        const nextRetryAt = new Date(Date.now() + this.retryDelayMs * Math.pow(2, item.retryCount));

        await db.collection('publishQueue').doc(item.id).update({
            status: 'retry',
            retryCount: item.retryCount + 1,
            nextRetryAt,
            lastError: 'Scheduled for retry'
        });

        logInfo(`Scheduled retry for queue item ${item.id}, attempt ${item.retryCount + 1}`);
    }

    /**
     * Mark item as completed
     */
    async markCompleted(itemId, results) {
        await db.collection('publishQueue').doc(itemId).update({
            status: 'completed',
            completedAt: new Date(),
            results
        });

        logInfo(`Queue item ${itemId} completed successfully`);
    }

    /**
     * Mark item as failed
     */
    async markFailed(itemId, error) {
        await db.collection('publishQueue').doc(itemId).update({
            status: 'failed',
            failedAt: new Date(),
            lastError: error
        });

        // Move to failed posts collection for manual review
        const itemDoc = await db.collection('publishQueue').doc(itemId).get();
        if (itemDoc.exists) {
            await db.collection('failedPosts').doc(itemId).set({
                ...itemDoc.data(),
                failedAt: new Date(),
                error
            });
        }

        logWarn(`Queue item ${itemId} failed permanently: ${error}`);
    }

    /**
     * Get queue status for user
     */
    async getUserQueueStatus(uid) {
        const snapshot = await db.collection('publishQueue')
            .where('uid', '==', uid)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }

    /**
     * Retry failed posts manually
     */
    async retryFailedPosts(uid, postIds) {
        const batch = db.batch();

        for (const postId of postIds) {
            const failedDoc = await db.collection('failedPosts').doc(postId).get();
            if (failedDoc.exists) {
                const failedData = failedDoc.data();

                // Move back to queue for retry
                const queueRef = db.collection('publishQueue').doc(postId);
                batch.set(queueRef, {
                    ...failedData,
                    status: 'queued',
                    retryCount: 0,
                    nextRetryAt: new Date(),
                    lastError: null
                });

                // Remove from failed posts
                batch.delete(failedDoc.ref);
            }
        }

        await batch.commit();
        logInfo(`Retried ${postIds.length} failed posts for user ${uid}`);

        // Start processing
        this.processQueue();
    }

    /**
     * Cancel queued items
     */
    async cancelQueuedItems(uid, itemIds) {
        const batch = db.batch();

        for (const itemId of itemIds) {
            const itemRef = db.collection('publishQueue').doc(itemId);
            const itemDoc = await itemRef.get();

            if (itemDoc.exists && itemDoc.data().uid === uid) {
                batch.update(itemRef, {
                    status: 'cancelled',
                    cancelledAt: new Date()
                });
            }
        }

        await batch.commit();
        logInfo(`Cancelled ${itemIds.length} queue items for user ${uid}`);
    }
}

// Start queue processing
const publishQueue = new PublishQueue();
setInterval(() => publishQueue.processQueue(), 10000); // Check every 10 seconds

module.exports = publishQueue;
