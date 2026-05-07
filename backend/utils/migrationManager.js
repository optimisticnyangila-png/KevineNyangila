const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { info: logInfo, error: logError } = require('../utils/logger');

const db = admin.firestore();
const migrationsCollection = 'migrations';

/**
 * Migration system for Firestore schema versioning
 * Supports up/down migrations with proper ordering
 */
class MigrationManager {
    constructor() {
        this.migrationsDir = path.join(__dirname, '..', 'migrations');
        this.migrations = [];
    }

    /**
     * Load all migration files
     */
    async loadMigrations() {
        const files = fs.readdirSync(this.migrationsDir)
            .filter(file => file.endsWith('.js'))
            .sort();

        for (const file of files) {
            const migration = require(path.join(this.migrationsDir, file));
            this.migrations.push({
                name: file.replace('.js', ''),
                ...migration
            });
        }

        logInfo(`Loaded ${this.migrations.length} migrations`);
    }

    /**
     * Get list of applied migrations
     */
    async getAppliedMigrations() {
        const snapshot = await db.collection(migrationsCollection).get();
        return snapshot.docs.map(doc => doc.id);
    }

    /**
     * Run pending migrations
     */
    async migrate() {
        await this.loadMigrations();
        const applied = await this.getAppliedMigrations();

        const pending = this.migrations.filter(m => !applied.includes(m.name));

        if (pending.length === 0) {
            logInfo('No pending migrations');
            return;
        }

        logInfo(`Running ${pending.length} pending migrations`);

        for (const migration of pending) {
            try {
                logInfo(`Running migration: ${migration.name}`);
                await migration.up(db);

                // Record migration as applied
                await db.collection(migrationsCollection).doc(migration.name).set({
                    appliedAt: new Date(),
                    version: migration.version || '1.0.0'
                });

                logInfo(`Migration ${migration.name} completed successfully`);
            } catch (error) {
                logError(`Migration ${migration.name} failed`, { error: error.message });
                throw error;
            }
        }

        logInfo('All migrations completed');
    }

    /**
     * Rollback last migration
     */
    async rollback() {
        await this.loadMigrations();
        const applied = await this.getAppliedMigrations();

        if (applied.length === 0) {
            logInfo('No migrations to rollback');
            return;
        }

        const lastMigration = this.migrations
            .filter(m => applied.includes(m.name))
            .pop();

        if (!lastMigration) {
            logInfo('No migration found to rollback');
            return;
        }

        try {
            logInfo(`Rolling back migration: ${lastMigration.name}`);
            await lastMigration.down(db);

            // Remove migration record
            await db.collection(migrationsCollection).doc(lastMigration.name).delete();

            logInfo(`Migration ${lastMigration.name} rolled back successfully`);
        } catch (error) {
            logError(`Rollback of ${lastMigration.name} failed`, { error: error.message });
            throw error;
        }
    }

    /**
     * Get migration status
     */
    async status() {
        await this.loadMigrations();
        const applied = await this.getAppliedMigrations();

        const status = this.migrations.map(migration => ({
            name: migration.name,
            applied: applied.includes(migration.name),
            version: migration.version || '1.0.0'
        }));

        return status;
    }
}

module.exports = MigrationManager;
