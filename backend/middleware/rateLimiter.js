const redis = require('../utils/redis');
const { info: logInfo, warn: logWarn } = require('../utils/logger');

// Rate limit configurations (same as before)
const RATE_LIMITS = {
    userApiRequests: { windowMs: 60, maxRequests: 100 }, // seconds
    userPostsPerHour: { windowMs: 3600, maxRequests: 50 },
    accountPostsPerHour: { windowMs: 3600, maxRequests: 10 },
    platformPostsPerHour: { windowMs: 3600, maxRequests: 20 }
};

/**
 * Check rate limit using Redis
 * Uses the sliding window pattern for better accuracy
 */
async function checkRateLimit(key, config) {
    const now = Date.now();
    const windowStart = now - (config.windowMs * 1000);
    const redisKey = `ratelimit:${key}`;

    try {
        const multi = redis.multi();
        multi.zremrangebyscore(redisKey, 0, windowStart);
        multi.zadd(redisKey, now, now);
        multi.zcard(redisKey);
        multi.expire(redisKey, config.windowMs);

        const results = await multi.exec();
        const count = results[2][1];

        const isLimited = count > config.maxRequests;
        const resetTime = now + (config.windowMs * 1000);

        return { isLimited, resetTime, remaining: Math.max(0, config.maxRequests - count) };
    } catch (error) {
        logWarn('Redis rate limit check failed', { error: error.message });
        return { isLimited: false, remaining: 1 }; // Fail open for reliability
    }
}

module.exports = async(req, res, next) => {
    try {
        const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const ipLimit = await checkRateLimit(`ip:${ip}`, RATE_LIMITS.userApiRequests);

        if (ipLimit.isLimited) {
            return res.status(429).json({ error: 'Too many requests from this IP.', retryAfter: config.windowMs });
        }

        if (req.user?.uid) {
            const uid = req.user.uid;
            const userApiLimit = await checkRateLimit(`user:api:${uid}`, RATE_LIMITS.userApiRequests);
            if (userApiLimit.isLimited) {
                logWarn(`User ${uid} exceeded API rate limit`);
                return res.status(429).json({ error: 'Too many API requests.' });
            }

            if (req.path.includes('/publish') || req.path.includes('/create-post')) {
                const userPostLimit = await checkRateLimit(`user:posts:${uid}`, RATE_LIMITS.userPostsPerHour);
                if (userPostLimit.isLimited) {
                    logWarn(`User ${uid} exceeded posting rate limit`);
                    return res.status(429).json({ error: 'Too many posts created.' });
                }
            }
        }

        next();
    } catch (error) {
        logWarn('Rate limiter middleware error', { error: error.message });
        next();
    }
};

module.exports.checkAccountLimit = async(uid, accountId, platform) => {
    const accountLimit = await checkRateLimit(`account:${platform}:${accountId}`, RATE_LIMITS.accountPostsPerHour);
    if (accountLimit.isLimited) return { allowed: false, retryAfter: 3600 };

    const platformLimit = await checkRateLimit(`user:platform:${uid}:${platform}`, RATE_LIMITS.platformPostsPerHour);
    if (platformLimit.isLimited) return { allowed: false, retryAfter: 3600 };

    return { allowed: true };
};
