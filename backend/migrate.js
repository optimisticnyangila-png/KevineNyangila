#!/usr/bin/env node

const MigrationManager = require('./utils/migrationManager');

async function main() {
    const command = process.argv[2] || 'migrate';

    try {
        const manager = new MigrationManager();

        switch (command) {
            case 'migrate':
                console.log('🚀 Running database migrations...');
                await manager.migrate();
                console.log('✅ Migrations completed successfully');
                break;

            case 'rollback':
                console.log('⏪ Rolling back last migration...');
                await manager.rollback();
                console.log('✅ Rollback completed successfully');
                break;

            case 'status':
                console.log('📊 Migration status:');
                const status = await manager.status();
                status.forEach(migration => {
                    const icon = migration.applied ? '✅' : '⏳';
                    console.log(`${icon} ${migration.name} (v${migration.version})`);
                });
                break;

            default:
                console.log('Usage: node migrate.js [migrate|rollback|status]');
                process.exit(1);
        }
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
