/**
 * WebSocket Client for Real-time Publishing Updates
 * Connects to FlowPost backend for live queue and publishing status
 */

class PublishingDashboard {
    constructor(apiBase, frontendOrigin) {
        const runtimeConfig = typeof window !== 'undefined' ? (window.__FLOWPOST_CONFIG__ || {}) : {};
        this.apiBase = apiBase || runtimeConfig.API_BASE || 'http://localhost:' + 5000;
        this.frontendOrigin = frontendOrigin || runtimeConfig.FRONTEND_ORIGIN || 'http://localhost:' + 3000;
        this.socket = null;
        this.isConnected = false;
        this.activePublishJobs = new Map(); // jobId -> job details
        this.eventHandlers = {
            'jobQueued': [],
            'jobStarted': [],
            'jobProgress': [],
            'jobCompleted': [],
            'jobFailed': [],
            'jobRetrying': [],
            'connectionEstablished': [],
            'connectionLost': []
        };
    }

    /**
     * Initialize WebSocket connection
     */
    connect(token) {
        return new Promise((resolve, reject) => {
            try {
                // Get socket.io from global scope (already included in HTML)
                if (typeof io === 'undefined') {
                    reject(new Error('Socket.IO not loaded. Ensure socket.io.min.js is included in HTML.'));
                    return;
                }

                this.socket = io(this.apiBase, {
                    auth: {
                        token: token || localStorage.getItem('auth_token')
                    },
                    reconnection: true,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    reconnectionAttempts: 5
                });

                // Connection events
                this.socket.on('connect', () => {
                    console.log('✅ WebSocket connected');
                    this.isConnected = true;
                    this._emit('connectionEstablished', {});
                    resolve();
                });

                this.socket.on('disconnect', () => {
                    console.warn('⚠️ WebSocket disconnected');
                    this.isConnected = false;
                    this._emit('connectionLost', {});
                });

                // Publishing events
                this.socket.on('publish:queued', (data) => {
                    console.log('📋 Job queued:', data);
                    this._handleJobQueued(data);
                    this._emit('jobQueued', data);
                });

                this.socket.on('publish:started', (data) => {
                    console.log('▶️ Job started:', data);
                    this._handleJobStarted(data);
                    this._emit('jobStarted', data);
                });

                this.socket.on('publish:progress', (data) => {
                    console.log('⏳ Job progress:', data);
                    this._handleJobProgress(data);
                    this._emit('jobProgress', data);
                });

                this.socket.on('publish:completed', (data) => {
                    console.log('✅ Job completed:', data);
                    this._handleJobCompleted(data);
                    this._emit('jobCompleted', data);
                });

                this.socket.on('publish:failed', (data) => {
                    console.error('❌ Job failed:', data);
                    this._handleJobFailed(data);
                    this._emit('jobFailed', data);
                });

                this.socket.on('publish:retrying', (data) => {
                    console.warn('🔄 Job retrying:', data);
                    this._handleJobRetrying(data);
                    this._emit('jobRetrying', data);
                });

                // Error handling
                this.socket.on('connect_error', (error) => {
                    console.error('Connection error:', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Disconnect WebSocket
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.isConnected = false;
        }
    }

    /**
     * Listen to publishing events
     */
    on(event, callback) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].push(callback);
        }
    }

    /**
     * Stop listening to events
     */
    off(event, callback) {
        if (this.eventHandlers[event]) {
            const index = this.eventHandlers[event].indexOf(callback);
            if (index > -1) {
                this.eventHandlers[event].splice(index, 1);
            }
        }
    }

    /**
     * Emit event to all listeners
     */
    _emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in ${event} handler:`, error);
                }
            });
        }
    }

    /**
     * Handle job queued
     */
    _handleJobQueued(data) {
        const { jobId, postId, message } = data;
        this.activePublishJobs.set(jobId, {
            id: jobId,
            postId,
            status: 'queued',
            message,
            startTime: Date.now(),
            progress: 0
        });
    }

    /**
     * Handle job started
     */
    _handleJobStarted(data) {
        const { jobId, postId, message } = data;
        if (this.activePublishJobs.has(jobId)) {
            const job = this.activePublishJobs.get(jobId);
            job.status = 'processing';
            job.message = message;
        }
    }

    /**
     * Handle job progress
     */
    _handleJobProgress(data) {
        const { jobId, postId, message, results } = data;
        if (this.activePublishJobs.has(jobId)) {
            const job = this.activePublishJobs.get(jobId);
            job.status = 'processing';
            job.message = message;
            job.results = results;
            job.progress = this._calculateProgress(results);
        }
    }

    /**
     * Handle job completed
     */
    _handleJobCompleted(data) {
        const { jobId, postId, message, results } = data;
        if (this.activePublishJobs.has(jobId)) {
            const job = this.activePublishJobs.get(jobId);
            job.status = 'completed';
            job.message = message;
            job.results = results;
            job.progress = 100;
            job.completedAt = Date.now();
        }
    }

    /**
     * Handle job failed
     */
    _handleJobFailed(data) {
        const { jobId, postId, message, error, attempts } = data;
        if (this.activePublishJobs.has(jobId)) {
            const job = this.activePublishJobs.get(jobId);
            job.status = 'failed';
            job.message = message;
            job.error = error;
            job.attempts = attempts;
            job.failedAt = Date.now();
        }
    }

    /**
     * Handle job retrying
     */
    _handleJobRetrying(data) {
        const { jobId, postId, message, attempt, nextRetryIn } = data;
        if (this.activePublishJobs.has(jobId)) {
            const job = this.activePublishJobs.get(jobId);
            job.status = 'retrying';
            job.message = message;
            job.attempt = attempt;
            job.nextRetryIn = nextRetryIn;
        }
    }

    /**
     * Calculate progress from results
     */
    _calculateProgress(results) {
        if (!results || typeof results !== 'object') return 0;
        const entries = Object.entries(results);
        if (entries.length === 0) return 0;
        const successful = entries.filter(([_, result]) => result.success).length;
        return Math.round((successful / entries.length) * 100);
    }

    /**
     * Get job status
     */
    getJobStatus(jobId) {
        return this.activePublishJobs.get(jobId) || null;
    }

    /**
     * Get all active jobs
     */
    getActiveJobs() {
        return Array.from(this.activePublishJobs.values());
    }

    /**
     * Clear completed/failed jobs
     */
    clearCompletedJobs() {
        for (const [jobId, job] of this.activePublishJobs.entries()) {
            if (job.status === 'completed' || job.status === 'failed') {
                this.activePublishJobs.delete(jobId);
            }
        }
    }

    /**
     * Subscribe to user's publish updates
     */
    subscribeToUpdates(uid) {
        if (this.socket && this.isConnected) {
            this.socket.emit('subscribe:publishing', { uid });
        }
    }

    /**
     * Unsubscribe from user's publish updates
     */
    unsubscribeFromUpdates(uid) {
        if (this.socket && this.isConnected) {
            this.socket.emit('unsubscribe:publishing', { uid });
        }
    }
}

// Export for use in browser or Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PublishingDashboard;
}
