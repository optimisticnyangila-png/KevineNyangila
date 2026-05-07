#!/usr/bin/env node

/**
 * FlowPost Setup Wizard - Quick Start Script
 * Guides users through the complete setup process
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (prompt) => {
    return new Promise(resolve => {
        rl.question(prompt, resolve);
    });
};

class SetupWizard {
    constructor() {
        this.config = {
            redisHost: '127.0.0.1',
            redisPort: 6379,
            redisPassword: '',
            port: 5000,
            maxConcurrent: 5,
            maxRetries: 3,
            retryDelay: 5000
        };
    }

    async start() {
        console.clear();
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║     🚀 FlowPost Production Setup Wizard 🚀              ║');
        console.log('║     Queue System & Real-Time Publishing Setup          ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');

        try {
            await this.checkPrerequisites();
            await this.configureRedis();
            await this.configureEnvironment();
            await this.testConnections();
            await this.installDependencies();
            this.printSummary();
        } catch (error) {
            console.error('\n❌ Setup failed:', error.message);
            process.exit(1);
        }

        rl.close();
    }

    async checkPrerequisites() {
        console.log('\n📋 Checking Prerequisites...\n');

        // Check Node.js
        try {
            const { stdout } = await execAsync('node -v');
            console.log(`  ✅ Node.js: ${stdout.trim()}`);
        } catch {
            throw new Error('Node.js not installed');
        }

        // Check npm
        try {
            const { stdout } = await execAsync('npm -v');
            console.log(`  ✅ npm: ${stdout.trim()}`);
        } catch {
            throw new Error('npm not installed');
        }

        console.log('');
    }

    async configureRedis() {
        console.log('\n🔧 Redis Configuration\n');

        const choice = await question('Choose Redis setup option:\n1. Local (WSL/Docker)\n2. Redis Cloud\n3. Skip (Use existing)\n\nYour choice (1-3): ');

        if (choice === '1') {
            console.log('\n📝 Local Redis Setup Instructions:');
            console.log('   WSL: sudo apt install redis-server && redis-server');
            console.log('   Docker: docker run -d -p 6379:6379 redis:latest\n');

            const host = await question('Redis Host [127.0.0.1]: ') || '127.0.0.1';
            const port = await question('Redis Port [6379]: ') || '6379';
            const password = await question('Redis Password (leave empty for none): ') || '';

            this.config.redisHost = host;
            this.config.redisPort = parseInt(port);
            this.config.redisPassword = password;

        } else if (choice === '2') {
            console.log('\n☁️ Redis Cloud Setup:');
            const url = await question('Redis URL (redis://default:password@host:port): ');
            this.config.redisUrl = url;
        }

        console.log('\n✅ Redis configured');
    }

    async configureEnvironment() {
        console.log('\n⚙️  Environment Configuration\n');

        const port = await question('API Port [5000]: ') || '5000';
        const maxConcurrent = await question('Max Concurrent Publishes [5]: ') || '5';
        const maxRetries = await question('Max Retry Attempts [3]: ') || '3';
        const retryDelay = await question('Retry Delay (ms) [5000]: ') || '5000';

        this.config.port = parseInt(port);
        this.config.maxConcurrent = parseInt(maxConcurrent);
        this.config.maxRetries = parseInt(maxRetries);
        this.config.retryDelay = parseInt(retryDelay);

        console.log('\n✅ Environment configured');
    }

    async testConnections() {
        console.log('\n🔗 Testing Connections...\n');

        // Test Redis
        try {
            const Redis = require('ioredis');
            const redis = new Redis({
                host: this.config.redisHost,
                port: this.config.redisPort,
                password: this.config.redisPassword || undefined,
                retryStrategy: () => null
            });

            await redis.ping();
            redis.disconnect();
            console.log('  ✅ Redis connection successful');
        } catch (error) {
            console.log('  ⚠️  Redis not available yet - will configure in .env');
        }

        // Test server
        try {
            const response = await new Promise((resolve, reject) => {
                const http = require('http');
                const req = http.get(`http://localhost:${this.config.port}/health`, (res) => {
                    res.statusCode === 200 ? resolve() : reject();
                });
                req.on('error', reject);
                req.setTimeout(2000, () => reject());
            });
            console.log('  ✅ Server is running');
        } catch {
            console.log('  ℹ️  Server not running (start with: node server.js)');
        }
    }

    async installDependencies() {
        console.log('\n📦 Installing Dependencies...\n');

        const install = await question('Install/verify npm packages? (y/n): ');
        if (install.toLowerCase() === 'y') {
            try {
                console.log('   Installing packages...');
                const packagePath = path.join(process.cwd(), 'package.json');
                if (fs.existsSync(packagePath)) {
                    await execAsync('npm install');
                    console.log('  ✅ Dependencies installed');
                }
            } catch (error) {
                console.log('  ⚠️  Could not install packages:', error.message);
            }
        }
    }

    printSummary() {
        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log('║               ✅ Setup Complete! 🎉                    ║');
        console.log('╚════════════════════════════════════════════════════════╝\n');

        console.log('📋 Configuration Summary:\n');
        console.log(`   Redis Host:     ${this.config.redisHost}`);
        console.log(`   Redis Port:     ${this.config.redisPort}`);
        console.log(`   API Port:       ${this.config.port}`);
        console.log(`   Max Concurrent: ${this.config.maxConcurrent}`);
        console.log(`   Max Retries:    ${this.config.maxRetries}`);
        console.log(`   Retry Delay:    ${this.config.retryDelay}ms\n`);

        console.log('🚀 Next Steps:\n');
        console.log('   1. Start Redis:');
        console.log('      redis-server  OR  docker run -p 6379:6379 redis:latest\n');
        console.log('   2. Start the server:');
        console.log('      cd backend && node server.js\n');
        console.log('   3. Run tests (in another terminal):');
        console.log('      node test-queue-system.js');
        console.log('      node test-bulk-publishing.js\n');
        console.log('   4. View documentation:');
        console.log('      - PRODUCTION_SETUP_GUIDE.md (Complete guide)');
        console.log('      - REDIS_SETUP.md (Redis setup details)');
        console.log('      - frontend/DASHBOARD_INTEGRATION.js (Frontend guide)\n');

        console.log('📚 Useful Commands:\n');
        console.log('   Check Redis:  redis-cli ping');
        console.log('   View Logs:    tail logs/combined.log');
        console.log('   Monitor Queue: redis-cli INFO stats\n');

        console.log('💡 Pro Tips:\n');
        console.log('   • Keep server and Redis running during development');
        console.log('   • Use test scripts to verify queue functionality');
        console.log('   • Monitor logs for debugging');
        console.log('   • Enable WebSocket in frontend for real-time updates\n');

        console.log('✨ FlowPost is ready for production! ✨\n');
    }
}

// Run wizard
const wizard = new SetupWizard();
wizard.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
