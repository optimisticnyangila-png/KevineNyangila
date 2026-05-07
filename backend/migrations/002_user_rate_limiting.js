const { info: logInfo } = require('../utils/logger');

/**
 * Add user rate limiting and account management features
 * Version: 1.1.0
 */
module.exports = {
    version: '1.1.0',

    async up(db) {
        logInfo('Running migration 002_user_rate_limiting');

        // Create userRateLimits collection for per-user rate limiting
        const rateLimitsRef = db.collection('userRateLimits');

        // Create accountPublishHistory collection for tracking publishes per account
        const historyRef = db.collection('accountPublishHistory');

        // Create publishQueue collection for Redis-like queuing (using Firestore for now)
        const queueRef = db.collection('publishQueue');

        // Create failedPosts collection for auto-retry system
        const failedRef = db.collection('failedPosts');

        // Create userSettings collection for user preferences
        const settingsRef = db.collection('userSettings');

        logInfo('Created new collections for rate limiting and account management');
    },

    async down(db) {
        logInfo('Rolling back migration 002_user_rate_limiting');

        // Remove collections created in this migration
        const collections = [
            'userRateLimits',
            'accountPublishHistory',
            'publishQueue',
            'failedPosts',
            'userSettings'
        ];

        for (const collection of collections) {
            const snapshot = await db.collection(collection).get();
            const batch = db.batch();

            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();
            logInfo(`Removed collection: ${collection}`);
        }
    }
};
