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

const publishQueue = new Queue('flowpost-publish', {
    redis: redisConfig,
    defaultJobOptions: {
        attempts: parseInt(process.env.MAX_RETRY_ATTEMPTS, 10) || 3,
        backoff: {
            type: 'exponential',
            delay: parseInt(process.env.RETRY_DELAY_MS, 10) || 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
    },
});

class RedisPublishQueue {
    constructor() {
        this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_PUBLISHES, 10) || 5;
        this.setupQueueProcessor();
        this.setupEventHandlers();
    }

    setupQueueProcessor() {
        publishQueue.process('publish-post', this.maxConcurrent, async(job) => {
            const { uid, postId, post, targets } = job.data;
            try {
                logInfo(`Processing job ${job.id} (Post: ${postId})`);
                const validTargets = [];
                for (const target of targets) {
                    const limit = await checkAccountLimit(uid, target.accountId, target.platform);
                    if (limit.allowed) validTargets.push(target);
                    else {
                        job.data.results = job.data.results || {};
                        job.data.results[target.id] = { success: false, error: 'Rate limit exceeded' };
                    }
                }

                if (validTargets.length === 0) throw new Error('No targets available (rate limited)');

                const publishResults = await publishToPlatforms(post);
                job.data.results = {...job.data.results, ...publishResults };

                const allFailed = Object.values(publishResults).every(r => !r.success);
                if (allFailed) throw new Error('All publish attempts failed');

                return { success: true, results: job.data.results };
            } catch (error) {
                logError(`Job ${job.id} failed: ${error.message}`);
                throw error;
            }
        });
    }

    setupEventHandlers() {
        publishQueue.on('completed', (job, result) => {
            this.emitRealTimeUpdate(job.data.uid, 'publish:completed', { jobId: job.id, postId: job.data.postId, results: result.results });
        });
        publishQueue.on('failed', (job, err) => {
            this.emitRealTimeUpdate(job.data.uid, 'publish:failed', { jobId: job.id, postId: job.data.postId, error: err.message });
        });
    }

    emitRealTimeUpdate(uid, event, data) {
        try {
            const { socketManager } = require('../server');
            if (socketManager) socketManager.sendPublishUpdate(uid, data.postId, event.split(':')[1], data);
        } catch (e) {}
    }

    async enqueuePosts(uid, posts, targets) {
        const jobs = [];
        for (const post of posts) {
            const jobData = { uid, postId: post.id, post, targets, results: {} };
            // Use deterministic jobId to prevent duplicates during server/scheduler restarts
            const job = await publishQueue.add('publish-post', jobData, {
                jobId: `publish_${post.id}_${uid}`,
                priority: post.priority || 0,
                delay: post.delay || 0
            });
            jobs.push({ id: job.id, postId: post.id, status: 'queued' });
        }
        return jobs;
    }

    async getUserActiveJobs(uid) {
        const jobs = await publishQueue.getJobs(['active', 'waiting', 'delayed']);
        return jobs.filter(j => j.data.uid === uid).map(j => ({ id: j.id, postId: j.data.postId, status: 'queued' }));
    }

    async cancelJob(uid, jobId) {
        const job = await publishQueue.getJob(jobId);
        if (job && job.data.uid === uid) await job.remove();
    }
}

module.exports = new RedisPublishQueue();
