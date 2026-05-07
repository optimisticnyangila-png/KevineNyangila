const Queue = require('bull');
const Redis = require('ioredis');
const { info: logInfo, error: logError, warn: logWarn } = require('./logger');
const { publishToPlatforms } = require('./publishUtils');
const { checkAccountLimit } = require('../middleware/rateLimiter');

// Redis configuration
const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true
};

// Create Redis clients for Bull
const redisClient = new Redis(redisConfig);
const subscriber = new Redis(redisConfig);

// Create publish queue with Bull
const publishQueue = new Queue('flowpost-publish', {
    redis: redisConfig,
    defaultJobOptions: {
        attempts: parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3,
        backoff: {
            type: 'exponential',
            delay: parseInt(process.env.RETRY_DELAY_MS, 10) || 5000,
        },
        removeOnComplete: 50,
        removeOnFail: 20,
    },
});

/**
 * Redis-based Publish Queue System
 * Handles bulk posting, retries, and real-time status updates
 */
class RedisPublishQueue {
    constructor() {
        this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_PUBLISHES, 10) || 5;
        this.retryAttempts = parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3;
        this.retryDelayMs = parseInt(process.env.RETRY_DELAY_MS, 10) || 5000;

        this.setupQueueProcessor();
        this.setupEventHandlers();
    }

    /**
     * Setup queue processor
     */
    setupQueueProcessor() {
        publishQueue.process('publish-post', this.maxConcurrent, async(job) => {
            const { uid, postId, post, targets } = job.data;

            try {
                logInfo(`Processing publish job ${job.id} for user ${uid}, post ${postId}`);

                // Check rate limits for each target
                const validTargets = [];
                for (const target of targets) {
                    const accountLimit = await checkAccountLimit(uid, target.accountId, target.platform);
                    if (accountLimit.allowed) {
                        validTargets.push(target);
                    } else {
                        logWarn(`Rate limit exceeded for ${target.platform} account ${target.accountId}`);
                        // Still include in results but mark as rate limited
                        job.data.results = job.data.results || {};
                        job.data.results[target.id] = {
                            success: false,
                            error: 'Rate limit exceeded',
                            retryAfter: accountLimit.retryAfter
                        };
                    }
                }

                if (validTargets.length === 0) {
                    throw new Error('All targets rate limited');
                }

                // Publish to valid targets
                const publishResults = await publishToPlatforms(post, validTargets);

                // Update results
                job.data.results = {...job.data.results, ...publishResults };

                // Check if all targets failed
                const allFailed = Object.values(publishResults).every(result => !result.success);
                if (allFailed) {
                    throw new Error('All publish attempts failed');
                }

                logInfo(`Publish job ${job.id} completed successfully`);
                return { success: true, results: job.data.results };

            } catch (error) {
                logError(`Publish job ${job.id} failed`, { error: error.message, uid, postId });
                throw error;
            }
        });
    }

    /**
     * Setup event handlers for monitoring
     */
    setupEventHandlers() {
        // Job completed
        publishQueue.on('completed', (job, result) => {
            logInfo(`Job ${job.id} completed`, { uid: job.data.uid, postId: job.data.postId });
            this.emitRealTimeUpdate(job.data.uid, 'publish:completed', {
                jobId: job.id,
                postId: job.data.postId,
                results: result.results
            });
        });

        // Job failed
        publishQueue.on('failed', (job, err) => {
            logError(`Job ${job.id} failed permanently`, {
                error: err.message,
                uid: job.data.uid,
                postId: job.data.postId,
                attempts: job.attemptsMade
            });

            // Move to failed collection for manual review
            this.handleFailedJob(job, err);

            this.emitRealTimeUpdate(job.data.uid, 'publish:failed', {
                jobId: job.id,
                postId: job.data.postId,
                error: err.message,
                attempts: job.attemptsMade
            });
        });

        // Job retrying
        publishQueue.on('retrying', (job, err) => {
            logWarn(`Retrying job ${job.id}, attempt ${job.attemptsMade + 1}`, {
                error: err.message,
                uid: job.data.uid,
                postId: job.data.postId
            });

            this.emitRealTimeUpdate(job.data.uid, 'publish:retrying', {
                jobId: job.id,
                postId: job.data.postId,
                attempt: job.attemptsMade + 1,
                nextRetryIn: job.opts.backoff.delay
            });
        });

        // Job active/processing
        publishQueue.on('active', (job) => {
            logInfo(`Job ${job.id} started processing`, { uid: job.data.uid, postId: job.data.postId });
            this.emitRealTimeUpdate(job.data.uid, 'publish:started', {
                jobId: job.id,
                postId: job.data.postId
            });
        });
    }

    /**
     * Handle permanently failed jobs
     */
    async handleFailedJob(job, error) {
        try {
            const admin = require('firebase-admin');
            const db = admin.firestore();

            await db.collection('failedPosts').doc(job.id).set({
                jobId: job.id,
                uid: job.data.uid,
                postId: job.data.postId,
                post: job.data.post,
                targets: job.data.targets,
                results: job.data.results,
                error: error.message,
                attempts: job.attemptsMade,
                failedAt: new Date(),
                lastAttemptAt: job.finishedOn
            });

            logInfo(`Failed job ${job.id} moved to failedPosts collection`);
        } catch (dbError) {
            logError(`Failed to save failed job ${job.id} to database`, { error: dbError.message });
        }
    }

    /**
     * Emit real-time updates via WebSocket
     */
    emitRealTimeUpdate(uid, event, data) {
        try {
            const { socketManager } = require('../server');
            if (socketManager) {
                socketManager.sendPublishUpdate(uid, data.postId, event.split(':')[1], data);
            }
        } catch (error) {
            // Socket manager might not be initialized yet
            logWarn('Could not emit real-time update', { error: error.message });
        }
    }

    /**
     * Add posts to publish queue
     */
    async enqueuePosts(uid, posts, targets) {
        const jobs = [];

        for (const post of posts) {
            const jobData = {
                uid,
                postId: post.id,
                post,
                targets,
                results: {}
            };

            const job = await publishQueue.add('publish-post', jobData, {
                priority: post.priority || 0,
                delay: post.delay || 0
            });

            jobs.push({
                id: job.id,
                postId: post.id,
                status: 'queued'
            });

            logInfo(`Enqueued publish job ${job.id} for user ${uid}, post ${post.id}`);
        }

        return jobs;
    }

    /**
     * Get user's active jobs
     */
    async getUserActiveJobs(uid) {
        const jobs = await publishQueue.getJobs(['active', 'waiting', 'delayed'], 0, 50);
        return jobs
            .filter(job => job.data.uid === uid)
            .map(job => ({
                id: job.id,
                postId: job.data.postId,
                status: job.opts.state || 'queued',
                progress: job.progress(),
                attempts: job.attemptsMade,
                createdAt: job.timestamp
            }));
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        const job = await publishQueue.getJob(jobId);
        if (!job) return null;

        return {
            id: job.id,
            postId: job.data.postId,
            uid: job.data.uid,
            status: await job.getState(),
            progress: job.progress(),
            attempts: job.attemptsMade,
            createdAt: job.timestamp,
            finishedAt: job.finishedOn,
            results: job.data.results
        };
    }

    /**
     * Cancel a job
     */
    async cancelJob(uid, jobId) {
        const job = await publishQueue.getJob(jobId);
        if (!job || job.data.uid !== uid) {
            throw new Error('Job not found or access denied');
        }

        await job.remove();
        logInfo(`Job ${jobId} cancelled by user ${uid}`);
    }

    /**
     * Retry failed jobs
     */
    async retryFailedJobs(uid, jobIds) {
        const admin = require('firebase-admin');
        const db = admin.firestore();

        for (const jobId of jobIds) {
            const failedDoc = await db.collection('failedPosts').doc(jobId).get();
            if (failedDoc.exists) {
                const failedData = failedDoc.data();

                // Re-enqueue the job
                await this.enqueuePosts(uid, [failedData.post], failedData.targets);

                // Remove from failed collection
                await failedDoc.ref.delete();

                logInfo(`Retried failed job ${jobId} for user ${uid}`);
            }
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            publishQueue.getWaiting(),
            publishQueue.getActive(),
            publishQueue.getCompleted(),
            publishQueue.getFailed(),
            publishQueue.getDelayed()
        ]);

        return {
            waiting: waiting.length,
            active: active.length,
            completed: completed.length,
            failed: failed.length,
            delayed: delayed.length,
            total: waiting.length + active.length + completed.length + failed.length + delayed.length
        };
    }

    /**
     * Graceful shutdown
     */
    async close() {
        try {
            await publishQueue.close();
            await redisClient.disconnect();
            await subscriber.disconnect();
            logInfo('Redis publish queue closed');
        } catch (error) {
            logError('Error closing Redis publish queue', { error: error.message });
            throw error;
        }
    }
}

// Create singleton instance
const redisPublishQueue = new RedisPublishQueue();

// Graceful shutdown
process.on('SIGTERM', async() => {
    try {
        await redisPublishQueue.close();
        process.exit(0);
    } catch (error) {
        logError('Error during graceful shutdown', { error: error.message });
        process.exit(1);
    }
});

process.on('SIGINT', async() => {
    try {
        await redisPublishQueue.close();
        process.exit(0);
    } catch (error) {
        logError('Error during graceful shutdown', { error: error.message });
        process.exit(1);
    }
});

module.exports = redisPublishQueue;