const admin = require('firebase-admin');
const { info: logInfo, warn: logWarn } = require('../utils/logger');

const db = admin.firestore();

// Rate limit configurations
const RATE_LIMITS = {
    // API requests per user per minute
    userApiRequests: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100
    },
    // Posts per user per hour
    userPostsPerHour: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 50
    },
    // Posts per account per hour
    accountPostsPerHour: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 10
    },
    // Posts per platform per user per hour
    platformPostsPerHour: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 20
    }
};

const requestStore = new Map();
const CLEANUP_INTERVAL_MS = 60000;

function cleanupStore() {
    const now = Date.now();
    for (const [key, record] of requestStore.entries()) {
        if (now - record.windowStart > Math.max(...Object.values(RATE_LIMITS).map(l => l.windowMs)) * 2) {
            requestStore.delete(key);
        }
    }
}

setInterval(cleanupStore, CLEANUP_INTERVAL_MS).unref();

/**
 * Check rate limit for a given key and configuration
 */
async function checkRateLimit(key, config) {
    const now = Date.now();
    const entry = requestStore.get(key) || { count: 0, windowStart: now };

    if (now - entry.windowStart > config.windowMs) {
        entry.count = 0;
        entry.windowStart = now;
    }

    entry.count += 1;
    requestStore.set(key, entry);

    const isLimited = entry.count > config.maxRequests;
    const resetTime = entry.windowStart + config.windowMs;

    return { isLimited, resetTime, remaining: Math.max(0, config.maxRequests - entry.count) };
}

/**
 * Rate limiter middleware with user and account-based limits
 */
module.exports = async(req, res, next) => {
    try {
        // Basic IP-based rate limiting (fallback)
        const ip = req.ip || req.headers['x-forwarded-for'] || req.connection ?.remoteAddress || 'unknown';
        const ipLimit = await checkRateLimit(`ip:${ip}`, RATE_LIMITS.userApiRequests);

        if (ipLimit.isLimited) {
            const retryAfterSeconds = Math.ceil((ipLimit.resetTime - Date.now()) / 1000);
            res.set('Retry-After', String(retryAfterSeconds));
            res.set('X-RateLimit-Remaining', String(ipLimit.remaining));
            res.set('X-RateLimit-Reset', String(Math.floor(ipLimit.resetTime / 1000)));
            return res.status(429).json({
                error: 'Too many requests from this IP, please try again later.',
                retryAfter: retryAfterSeconds
            });
        }

        // User-based rate limiting (if authenticated)
        if (req.user ?.uid) {
            const uid = req.user.uid;

            // API requests per user
            const userApiLimit = await checkRateLimit(`user:api:${uid}`, RATE_LIMITS.userApiRequests);
            if (userApiLimit.isLimited) {
                logWarn(`User ${uid} exceeded API rate limit`);
                const retryAfterSeconds = Math.ceil((userApiLimit.resetTime - Date.now()) / 1000);
                res.set('Retry-After', String(retryAfterSeconds));
                return res.status(429).json({
                    error: 'Too many API requests, please try again later.',
                    retryAfter: retryAfterSeconds
                });
            }

            // For publish endpoints, check posting limits
            if (req.path.includes('/publish') || req.path.includes('/create-post')) {
                const userPostLimit = await checkRateLimit(`user:posts:${uid}`, RATE_LIMITS.userPostsPerHour);
                if (userPostLimit.isLimited) {
                    logWarn(`User ${uid} exceeded posting rate limit`);
                    const retryAfterSeconds = Math.ceil((userPostLimit.resetTime - Date.now()) / 1000);
                    return res.status(429).json({
                        error: 'Too many posts created, please try again later.',
                        retryAfter: retryAfterSeconds
                    });
                }
            }
        }

        // Add rate limit headers
        res.set('X-RateLimit-Remaining', String(ipLimit.remaining));
        res.set('X-RateLimit-Reset', String(Math.floor(ipLimit.resetTime / 1000)));

        next();
    } catch (error) {
        logWarn('Rate limiter error', { error: error.message });
        // Don't block requests due to rate limiter errors
        next();
    }
};

/**
 * Check account-specific rate limits (for publishing)
 */
module.exports.checkAccountLimit = async(uid, accountId, platform) => {
    const accountKey = `account:${platform}:${accountId}`;
    const accountLimit = await checkRateLimit(accountKey, RATE_LIMITS.accountPostsPerHour);

    if (accountLimit.isLimited) {
        logWarn(`Account ${accountId} on ${platform} exceeded rate limit for user ${uid}`);
        return {
            allowed: false,
            retryAfter: Math.ceil((accountLimit.resetTime - Date.now()) / 1000)
        };
    }

    const platformKey = `user:platform:${uid}:${platform}`;
    const platformLimit = await checkRateLimit(platformKey, RATE_LIMITS.platformPostsPerHour);

    if (platformLimit.isLimited) {
        logWarn(`User ${uid} exceeded ${platform} posting rate limit`);
        return {
            allowed: false,
            retryAfter: Math.ceil((platformLimit.resetTime - Date.now()) / 1000)
        };
    }

    return { allowed: true };
};
