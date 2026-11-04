/**
 * @deprecated
 * LEGACY FIRESTORE QUEUE SYSTEM
 *
 * This file is kept for reference only.
 * The system now uses Redis-based queuing (redisPublishQueue.js)
 * for improved reliability and performance.
 *
 * DO NOT USE FOR NEW DEVELOPMENTS.
 */

module.exports = {
    enqueuePosts: () => { throw new Error('Legacy publishQueue is deprecated. Use redisPublishQueue instead.'); }
};
