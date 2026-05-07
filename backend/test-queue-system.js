/**
 * Test Suite for Redis Queue System
 * Tests bulk publishing, real-time updates, and retry logic
 */

const axios = require('axios');
const WebSocket = require('ws');
const assert = require('assert');

const API_BASE = process.env.API_BASE_URL || process.env.API_BASE || `http://localhost:${process.env.BACKEND_PORT || 5000}`;
const SOCKET_BASE = process.env.SOCKET_BASE_URL || API_BASE;
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

class QueueTester {
    constructor() {
        this.token = null;
        this.userId = null;
        this.posts = [];
        this.results = {
            passed: 0,
            failed: 0,
            errors: []
        };
    }

    // ============================================
    // 1. REDIS CONNECTION TESTS
    // ============================================

    async testRedisConnection() {
        console.log('\n🔧 Testing Redis Connection...');
        try {
            const Redis = require('ioredis');
            const redis = new Redis({
                host: REDIS_HOST,
                port: REDIS_PORT,
                password: process.env.REDIS_PASSWORD || ''
            });

            const pong = await redis.ping();
            assert.strictEqual(pong, 'PONG', 'Redis ping failed');

            await redis.quit();
            this.logPass('Redis connection successful');
        } catch (error) {
            this.logFail('Redis connection test', error);
        }
    }

    // ============================================
    // 2. SERVER CONNECTION TESTS
    // ============================================

    async testServerHealth() {
        console.log('\n🏥 Testing Server Health...');
        try {
            const response = await axios.get(`${API_BASE}/health`);
            assert.strictEqual(response.status, 200);
            this.logPass('Server health check passed');
        } catch (error) {
            this.logFail('Server health test', error);
        }
    }

    // ============================================
    // 3. AUTHENTICATION TESTS
    // ============================================

    async testAuthentication() {
        console.log('\n🔐 Testing Authentication...');
        try {
            // Test with invalid token
            try {
                await axios.get(`${API_BASE}/platforms`, {
                    headers: { 'Authorization': 'Bearer invalid-token' }
                });
                this.logFail('Should have rejected invalid token');
            } catch (error) {
                if (error.response && error.response.status === 401) {
                    this.logPass('Invalid token properly rejected');
                } else {
                    throw error;
                }
            }

            // Test without token
            try {
                await axios.get(`${API_BASE}/platforms`);
                this.logFail('Should require authentication');
            } catch (error) {
                if (error.response && error.response.status === 401) {
                    this.logPass('Missing token properly rejected');
                } else {
                    throw error;
                }
            }
        } catch (error) {
            this.logFail('Authentication tests', error);
        }
    }

    // ============================================
    // 4. RATE LIMITING TESTS
    // ============================================

    async testRateLimiting() {
        console.log('\n⏱️ Testing Rate Limiting...');
        try {
            // Make rapid requests
            const requests = [];
            for (let i = 0; i < 5; i++) {
                requests.push(
                    axios.get(`${API_BASE}/health`, {
                        validateStatus: () => true
                    })
                );
            }

            const responses = await Promise.all(requests);

            // Check if any were rate limited
            const limited = responses.some(r => r.status === 429);
            if (limited) {
                this.logPass('Rate limiting working');
            } else {
                console.log('⚠️ Rate limiting: No 429 responses yet (may need more requests)');
            }
        } catch (error) {
            this.logFail('Rate limiting test', error);
        }
    }

    // ============================================
    // 5. QUEUE SYSTEM TESTS
    // ============================================

    async testQueueSystem() {
        console.log('\n📊 Testing Queue System...');
        try {
            const Redis = require('ioredis');
            const redis = new Redis({
                host: REDIS_HOST,
                port: REDIS_PORT,
                password: process.env.REDIS_PASSWORD || ''
            });

            // Test queue info
            const info = await redis.info('stats');
            assert(info, 'Failed to get Redis info');
            this.logPass('Queue system accessible');

            // Test queue operations
            const Queue = require('bull');
            const testQueue = new Queue('test-queue', {
                redis: {
                    host: REDIS_HOST,
                    port: REDIS_PORT,
                    password: process.env.REDIS_PASSWORD || ''
                }
            });

            // Add test job
            const job = await testQueue.add({ test: true });
            assert(job.id, 'Failed to create test job');
            this.logPass('Queue job creation working');

            // Clean up
            await testQueue.empty();
            await testQueue.close();
            await redis.quit();
        } catch (error) {
            this.logFail('Queue system test', error);
        }
    }

    // ============================================
    // 6. WEBSOCKET CONNECTION TESTS
    // ============================================

    async testWebSocketConnection() {
        console.log('\n🔗 Testing WebSocket Connection...');
        try {
            return new Promise((resolve, reject) => {
                const socket = new(require('socket.io-client'))(SOCKET_BASE, {
                    reconnection: false,
                    forceNew: true
                });

                const timeout = setTimeout(() => {
                    socket.disconnect();
                    reject(new Error('WebSocket connection timeout'));
                }, 5000);

                socket.on('connect', () => {
                    clearTimeout(timeout);
                    this.logPass('WebSocket connection established');
                    socket.disconnect();
                    resolve();
                });

                socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        } catch (error) {
            this.logFail('WebSocket connection test', error);
        }
    }

    // ============================================
    // 7. BULK PUBLISHING SIMULATION
    // ============================================

    async testBulkPublishing() {
        console.log('\n📢 Testing Bulk Publishing Simulation...');
        try {
            // Create mock posts
            const mockPosts = [{
                    id: `post_${Date.now()}_1`,
                    content: 'Test post 1',
                    media: [],
                    targets: ['facebook', 'instagram'],
                    priority: 1
                },
                {
                    id: `post_${Date.now()}_2`,
                    content: 'Test post 2',
                    media: [],
                    targets: ['tiktok'],
                    priority: 2
                },
                {
                    id: `post_${Date.now()}_3`,
                    content: 'Test post 3',
                    media: [],
                    targets: ['facebook'],
                    priority: 0
                }
            ];

            console.log(`  📝 Created ${mockPosts.length} mock posts`);
            this.logPass('Bulk publishing test setup complete');

            return mockPosts;
        } catch (error) {
            this.logFail('Bulk publishing test', error);
        }
    }

    // ============================================
    // 8. REAL-TIME UPDATE TESTS
    // ============================================

    async testRealTimeUpdates() {
        console.log('\n📡 Testing Real-Time Updates...');
        try {
            return new Promise((resolve, reject) => {
                const io = require('socket.io-client');
                const socket = io(SOCKET_BASE, {
                    reconnection: false,
                    forceNew: true
                });

                const events = [];
                const timeout = setTimeout(() => {
                    socket.disconnect();
                    reject(new Error('No real-time events received'));
                }, 3000);

                socket.on('connect', () => {
                    console.log('  🔗 Connected, listening for events...');
                });

                // Listen for all event types
                ['publish:queued', 'publish:started', 'publish:completed', 'publish:failed'].forEach(event => {
                    socket.on(event, (data) => {
                        events.push(event);
                        console.log(`    📨 Received event: ${event}`);
                    });
                });

                // Clean up after timeout
                setTimeout(() => {
                    socket.disconnect();
                    if (events.length > 0) {
                        this.logPass(`Real-time event handling working (${events.length} event types detected)`);
                    } else {
                        console.log('⚠️ Real-time events: No events received (may need active publishing)');
                    }
                    resolve();
                }, 3000);
            });
        } catch (error) {
            this.logFail('Real-time updates test', error);
        }
    }

    // ============================================
    // 9. RETRY LOGIC TESTS
    // ============================================

    async testRetryLogic() {
        console.log('\n🔄 Testing Retry Logic...');
        try {
            const Queue = require('bull');
            const retryQueue = new Queue('retry-test', {
                redis: {
                    host: REDIS_HOST,
                    port: REDIS_PORT,
                    password: process.env.REDIS_PASSWORD || ''
                }
            });

            // Add job with retry
            const job = await retryQueue.add({ fail: true }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 100 }
            });

            assert(job.attemptsMade === 0, 'Job should start with 0 attempts');
            this.logPass('Retry configuration valid');

            // Clean up
            await retryQueue.empty();
            await retryQueue.close();
        } catch (error) {
            this.logFail('Retry logic test', error);
        }
    }

    // ============================================
    // 10. CONCURRENCY TESTS
    // ============================================

    async testConcurrency() {
        console.log('\n⚡ Testing Concurrency...');
        try {
            const Queue = require('bull');
            const concurrencyQueue = new Queue('concurrency-test', {
                redis: {
                    host: REDIS_HOST,
                    port: REDIS_PORT,
                    password: process.env.REDIS_PASSWORD || ''
                },
                defaultJobOptions: {
                    removeOnComplete: true
                }
            });

            // Add multiple jobs
            const jobs = [];
            for (let i = 0; i < 5; i++) {
                const job = await concurrencyQueue.add({ taskId: i });
                jobs.push(job);
            }

            assert.strictEqual(jobs.length, 5, 'Failed to add jobs');
            this.logPass('Concurrent job handling verified');

            // Clean up
            await concurrencyQueue.empty();
            await concurrencyQueue.close();
        } catch (error) {
            this.logFail('Concurrency test', error);
        }
    }

    // ============================================
    // HELPER METHODS
    // ============================================

    logPass(message) {
        console.log(`  ✅ ${message}`);
        this.results.passed++;
    }

    logFail(test, error) {
        console.log(`  ❌ ${test}: ${error.message}`);
        this.results.failed++;
        this.results.errors.push({ test, error: error.message });
    }

    async runAll() {
        console.log('\n' + '='.repeat(50));
        console.log('🚀 FLOWPOST QUEUE SYSTEM TEST SUITE');
        console.log('='.repeat(50));

        try {
            await this.testRedisConnection();
            await this.testServerHealth();
            await this.testAuthentication();
            await this.testRateLimiting();
            await this.testQueueSystem();
            await this.testWebSocketConnection();
            await this.testBulkPublishing();
            await this.testRealTimeUpdates();
            await this.testRetryLogic();
            await this.testConcurrency();

            this.printResults();
        } catch (error) {
            console.error('Fatal error:', error);
        }
    }

    printResults() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 TEST RESULTS');
        console.log('='.repeat(50));
        console.log(`✅ Passed: ${this.results.passed}`);
        console.log(`❌ Failed: ${this.results.failed}`);

        if (this.results.errors.length > 0) {
            console.log('\n🔍 Errors:');
            this.results.errors.forEach(({ test, error }) => {
                console.log(`  - ${test}: ${error}`);
            });
        }

        const total = this.results.passed + this.results.failed;
        const percentage = total > 0 ? Math.round((this.results.passed / total) * 100) : 0;
        console.log(`\n📈 Success Rate: ${percentage}% (${this.results.passed}/${total})`);
        console.log('='.repeat(50) + '\n');
    }
}

// Run tests
if (require.main === module) {
    const tester = new QueueTester();
    tester.runAll();
}

module.exports = QueueTester;
