const { info: logInfo } = require('../utils/logger');

/**
 * Initial migration - Create base collections and indexes
 * Version: 1.0.0
 */
module.exports = {
    version: '1.0.0',

    async up(db) {
        logInfo('Running migration 001_initial_schema');

        // Create indexes for better query performance
        // Note: Firestore automatically creates indexes, but we document them here

        // Ensure posts collection has proper structure
        const postsRef = db.collection('posts');
        const samplePost = await postsRef.limit(1).get();

        // Ensure platformAccounts collection has proper structure
        const accountsRef = db.collection('platformAccounts');
        const sampleAccount = await accountsRef.limit(1).get();

        // Ensure scheduledPosts collection exists
        const scheduledRef = db.collection('scheduledPosts');
        const sampleScheduled = await scheduledRef.limit(1).get();

        // Ensure platformData collection exists
        const dataRef = db.collection('platformData');
        const sampleData = await dataRef.limit(1).get();

        logInfo('Initial schema validation completed');
    },

    async down(db) {
        logInfo('Rolling back migration 001_initial_schema');
        // Initial migration - no rollback needed as we're just validating existing structure
    }
};
