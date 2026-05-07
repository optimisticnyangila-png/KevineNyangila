/**
 * Integration Test: Bulk Publishing and Real-Time Monitoring
 * Simulates publishing multiple posts and monitors queue updates via WebSocket
 */

const axios = require('axios');
const io = require('socket.io-client');

const API_BASE = process.env.API_BASE_URL || process.env.API_BASE || `http://localhost:${process.env.BACKEND_PORT || 5000}`;

class BulkPublishingTest {
    constructor() {
        this.socket = null;
        this.jobs = new Map();
        this.stats = {
            totalPublished: 0,
            totalCompleted: 0,
            totalFailed: 0,
            totalRetried: 0,
            averageTime: 0,
            times: []
        };
    }

    /**
     * Connect to WebSocket
     */
    connect() {
        return new Promise((resolve, reject) => {
            console.log('🔗 Connecting to WebSocket...');
            this.socket = io(API_BASE, {
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                reconnectionAttempts: 10
            });

            this.socket.on('connect', () => {
                console.log('✅ WebSocket connected');
                this.setupEventHandlers();
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                reject(error);
            });

            setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 5000);
        });
    }

    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        this.socket.on('publish:queued', (data) => {
            console.log(`  📋 [${data.jobId}] Queued: ${data.message}`);
            this.jobs.set(data.jobId, {
                jobId: data.jobId,
                postId: data.postId,
                status: 'queued',
                startTime: Date.now(),
                events: ['queued']
            });
            this.stats.totalPublished++;
        });

        this.socket.on('publish:started', (data) => {
            console.log(`  ▶️  [${data.jobId}] Started: ${data.message}`);
            const job = this.jobs.get(data.jobId);
            if (job) {
                job.status = 'processing';
                job.events.push('started');
            }
        });

        this.socket.on('publish:progress', (data) => {
            console.log(`  ⏳ [${data.jobId}] Progress: ${data.message}`);
            const job = this.jobs.get(data.jobId);
            if (job) {
                job.events.push('progress');
                if (data.results) {
                    job.results = data.results;
                }
            }
        });

        this.socket.on('publish:completed', (data) => {
            const duration = Date.now() - this.jobs.get(data.jobId).startTime;
            console.log(`  ✅ [${data.jobId}] Completed in ${duration}ms`);

            const job = this.jobs.get(data.jobId);
            if (job) {
                job.status = 'completed';
                job.duration = duration;
                job.events.push('completed');
                job.results = data.results;
            }

            this.stats.totalCompleted++;
            this.stats.times.push(duration);
        });

        this.socket.on('publish:failed', (data) => {
            console.log(`  ❌ [${data.jobId}] Failed: ${data.error} (Attempt ${data.attempts})`);
            const job = this.jobs.get(data.jobId);
            if (job) {
                job.status = 'failed';
                job.error = data.error;
                job.attempts = data.attempts;
                job.events.push('failed');
            }

            this.stats.totalFailed++;
        });

        this.socket.on('publish:retrying', (data) => {
            console.log(`  🔄 [${data.jobId}] Retrying (Attempt ${data.attempt}, next in ${data.nextRetryIn}ms)`);
            const job = this.jobs.get(data.jobId);
            if (job) {
                job.status = 'retrying';
                job.events.push('retrying');
                job.nextRetryIn = data.nextRetryIn;
            }

            this.stats.totalRetried++;
        });
    }

    /**
     * Simulate publishing bulk posts
     */
    async simulateBulkPublishing(count = 3) {
        console.log(`\n📢 Simulating ${count} bulk posts...\n`);

        for (let i = 0; i < count; i++) {
            // Simulate: create post, get post data, publish
            const post = {
                id: `post_bulk_${Date.now()}_${i}`,
                content: `Bulk test post ${i + 1} - ${new Date().toLocaleString()}`,
                media: [],
                targets: [
                    { platform: 'facebook', accountId: 'fb_123' },
                    { platform: 'instagram', accountId: 'ig_456' },
                    { platform: 'tiktok', accountId: 'tt_789' }
                ]
            };

            try {
                console.log(`📤 Publishing post ${i + 1}/${count}: ${post.id}`);

                // Note: This requires authentication
                // In real scenario, you would have a valid auth token
                const response = await axios.post(`${API_BASE}/publish-post`, { postId: post.id }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.AUTH_TOKEN || 'mock-token'}`
                    },
                    validateStatus: () => true
                });

                if (response.status === 200) {
                    console.log(`  ✅ Post queued with job ID: ${response.data.queueId}`);
                } else if (response.status === 401) {
                    console.log(`  ⚠️  Authentication required (401)`);
                    console.log(`     To test real publishing, set AUTH_TOKEN environment variable`);
                } else {
                    console.log(`  ⚠️  Response: ${response.status}`);
                }
            } catch (error) {
                console.log(`  ❌ Error: ${error.message}`);
            }

            // Stagger requests
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    /**
     * Wait for all jobs to complete
     */
    async waitForCompletion(timeout = 30000) {
        console.log(`\n⏳ Waiting for all jobs to complete (timeout: ${timeout}ms)...\n`);

        return new Promise((resolve) => {
            const startTime = Date.now();

            const checkInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;

                if (elapsed > timeout) {
                    clearInterval(checkInterval);
                    console.log(`\n⏰ Timeout reached after ${timeout}ms`);
                    resolve();
                    return;
                }

                // Check if all jobs are done
                const jobs = Array.from(this.jobs.values());
                const pending = jobs.filter(j => j.status === 'queued' || j.status === 'processing' || j.status === 'retrying');

                if (jobs.length > 0 && pending.length === 0) {
                    console.log(`\n🎉 All ${jobs.length} jobs completed!`);
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 1000);
        });
    }

    /**
     * Print monitoring dashboard
     */
    printDashboard() {
        console.log('\n' + '='.repeat(70));
        console.log('📊 BULK PUBLISHING MONITORING DASHBOARD');
        console.log('='.repeat(70));

        console.log('\n📈 Statistics:');
        console.log(`  Total Published: ${this.stats.totalPublished}`);
        console.log(`  Completed: ${this.stats.totalCompleted}`);
        console.log(`  Failed: ${this.stats.totalFailed}`);
        console.log(`  Retried: ${this.stats.totalRetried}`);

        if (this.stats.times.length > 0) {
            const avgTime = Math.round(this.stats.times.reduce((a, b) => a + b, 0) / this.stats.times.length);
            const minTime = Math.min(...this.stats.times);
            const maxTime = Math.max(...this.stats.times);

            console.log(`\n⏱️  Performance Metrics:`);
            console.log(`  Average Time: ${avgTime}ms`);
            console.log(`  Min Time: ${minTime}ms`);
            console.log(`  Max Time: ${maxTime}ms`);
        }

        console.log(`\n📋 Job Details:`);
        for (const [jobId, job] of this.jobs.entries()) {
            const status = {
                'queued': '📋',
                'processing': '⏳',
                'completed': '✅',
                'failed': '❌',
                'retrying': '🔄'
            }[job.status] || '❓';

            const timeStr = job.duration ? ` (${job.duration}ms)` : '';
            console.log(`  ${status} [${jobId}] ${job.status.toUpperCase()}${timeStr}`);
            console.log(`     Events: ${job.events.join(' → ')}`);

            if (job.results) {
                console.log(`     Results: ${JSON.stringify(job.results)}`);
            }
            if (job.error) {
                console.log(`     Error: ${job.error}`);
            }
        }

        console.log('\n' + '='.repeat(70) + '\n');
    }

    /**
     * Disconnect WebSocket
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }

    /**
     * Run complete test
     */
    async runTest(postCount = 3) {
        try {
            console.log('\n🚀 BULK PUBLISHING INTEGRATION TEST');
            console.log('='.repeat(70));

            // Connect to WebSocket
            await this.connect();

            // Simulate bulk publishing
            await this.simulateBulkPublishing(postCount);

            // Wait for completion
            await this.waitForCompletion(30000);

            // Print results
            this.printDashboard();

            // Disconnect
            this.disconnect();

            console.log('✅ Test completed!');
        } catch (error) {
            console.error('❌ Test failed:', error);
            this.disconnect();
        }
    }
}

// Run test
if (require.main === module) {
    const test = new BulkPublishingTest();
    const count = parseInt(process.argv[2]) || 3;
    test.runTest(count);
}

module.exports = BulkPublishingTest;
