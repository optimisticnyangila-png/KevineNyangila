/**
 * Example: How to Use Publishing Dashboard in Your Frontend
 */

// 1. Include in HTML:
// <script src="publishingDashboard.js"></script>

// 2. Initialize in your frontend code:
const dashboard = new PublishingDashboard(
    window.__FLOWPOST_CONFIG__ && window.__FLOWPOST_CONFIG__.API_BASE,
    window.__FLOWPOST_CONFIG__ && window.__FLOWPOST_CONFIG__.FRONTEND_ORIGIN
);

// 3. Connect to WebSocket (requires authentication token)
async function initializeDashboard() {
    try {
        const token = localStorage.getItem('auth_token');
        await dashboard.connect(token);
        console.log('✅ Dashboard connected!');

        // Subscribe to publishing updates
        const userId = localStorage.getItem('user_id');
        dashboard.subscribeToUpdates(userId);

        // Listen for events
        setupEventListeners();
    } catch (error) {
        console.error('❌ Failed to connect dashboard:', error);
    }
}

// 4. Setup event listeners
function setupEventListeners() {
    // When a job is queued
    dashboard.on('jobQueued', (data) => {
        console.log('📋 Job queued:', data);
        updateDashboardUI('queued', data);
    });

    // When publishing starts
    dashboard.on('jobStarted', (data) => {
        console.log('▶️ Publishing started for post:', data.postId);
        updateDashboardUI('started', data);
    });

    // Real-time progress updates
    dashboard.on('jobProgress', (data) => {
        console.log(`⏳ Progress: ${data.progress}%`);
        updateProgressBar(data.jobId, data.progress);
        showResults(data.results);
    });

    // When publishing completes successfully
    dashboard.on('jobCompleted', (data) => {
        console.log('✅ Publishing completed!');
        updateDashboardUI('completed', data);
        showSuccessNotification(data);
    });

    // When publishing fails
    dashboard.on('jobFailed', (data) => {
        console.error('❌ Publishing failed:', data.error);
        updateDashboardUI('failed', data);
        showErrorNotification(data);
    });

    // When retrying after failure
    dashboard.on('jobRetrying', (data) => {
        console.warn(`🔄 Retrying in ${data.nextRetryIn}ms`);
        updateDashboardUI('retrying', data);
    });

    // Connection status
    dashboard.on('connectionEstablished', () => {
        console.log('🔗 Connected to real-time updates');
        showConnectionStatus('connected');
    });

    dashboard.on('connectionLost', () => {
        console.warn('⚠️ Lost connection to real-time updates');
        showConnectionStatus('disconnected');
    });
}

// 5. Example UI update functions (implement these based on your UI framework)
function updateDashboardUI(status, data) {
    const element = document.getElementById(`job-${data.jobId}`);
    if (element) {
        element.setAttribute('data-status', status);
        element.querySelector('.status').textContent = status.toUpperCase();
        element.querySelector('.message').textContent = data.message;
    }
}

function updateProgressBar(jobId, progress) {
    const progressBar = document.querySelector(`#job-${jobId} .progress-bar`);
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
}

function showResults(results) {
    console.log('Platform Results:', results);
    // Update your UI with platform-specific results
    Object.entries(results).forEach(([platform, result]) => {
        const element = document.querySelector(`[data-platform="${platform}"]`);
        if (element) {
            if (result.success) {
                element.classList.add('success');
                element.innerHTML = `✅ Posted to ${platform}`;
            } else {
                element.classList.add('error');
                element.innerHTML = `❌ Failed on ${platform}: ${result.error}`;
            }
        }
    });
}

function showSuccessNotification(data) {
    // Show success notification (use your UI library)
    alert(`✅ Post published successfully!\n\nJob ID: ${data.jobId}\nPost ID: ${data.postId}`);
}

function showErrorNotification(data) {
    // Show error notification
    alert(`❌ Publishing failed!\n\nError: ${data.error}\nAttempts: ${data.attempts}`);
}

function showConnectionStatus(status) {
    const indicator = document.getElementById('connection-status');
    if (indicator) {
        indicator.className = status;
        indicator.textContent = status === 'connected' ? '🟢 Connected' : '🔴 Disconnected';
    }
}

// 6. Publish a post via the API
async function publishPost(postId, targets) {
    try {
        const response = await fetch('/publish-post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            },
            body: JSON.stringify({ postId, targets })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('📨 Post sent to queue:', data);

        // Job is now in the queue, WebSocket will send updates
        return data;
    } catch (error) {
        console.error('❌ Error publishing post:', error);
        throw error;
    }
}

// 7. Retry failed posts
async function retryFailedPost(postId, targets) {
    try {
        const response = await fetch('/publish-post/retry', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            },
            body: JSON.stringify({ postId, targets })
        });

        const data = await response.json();
        console.log('🔄 Retry queued:', data);
        return data;
    } catch (error) {
        console.error('❌ Error retrying post:', error);
        throw error;
    }
}

// 8. Get current job status
function getJobStatus(jobId) {
    const job = dashboard.getJobStatus(jobId);
    console.log('Job Status:', job);
    return job;
}

// 9. Get all active jobs
function getAllJobs() {
    const jobs = dashboard.getActiveJobs();
    console.log('Active Jobs:', jobs);
    return jobs;
}

// 10. Cleanup on page unload
window.addEventListener('beforeunload', () => {
    const userId = localStorage.getItem('user_id');
    dashboard.unsubscribeFromUpdates(userId);
    dashboard.disconnect();
});

// Initialize when page loads and user is authenticated
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        initializeDashboard();
    }
});

// Make functions available globally (optional)
window.PublishingDashboard = {
    init: initializeDashboard,
    publish: publishPost,
    retry: retryFailedPost,
    getStatus: getJobStatus,
    getAll: getAllJobs,
    dashboard: dashboard
};
