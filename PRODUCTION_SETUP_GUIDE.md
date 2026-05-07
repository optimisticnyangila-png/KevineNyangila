# FlowPost Production Setup & Testing Guide

## Overview
This guide covers the complete setup and testing of the Redis-based queue system, real-time WebSocket updates, and bulk publishing capabilities for FlowPost.

---

## 📋 Prerequisites

- Node.js 24.x
- Windows or Windows Subsystem for Linux (WSL)
- FlowPost backend running on port 5000
- FirebaseAdmin SDK configured

---

## Step 1: Install Redis

### Option A: Windows Subsystem for Linux (WSL) - Recommended

```bash
# Open WSL Terminal
wsl

# Update package list
sudo apt update

# Install Redis
sudo apt install -y redis-server

# Start Redis
redis-server

# In another WSL terminal, verify:
redis-cli ping
# Should return: PONG
```

### Option B: Docker

```bash
# Pull Redis image
docker pull redis:latest

# Run container
docker run -d -p 6379:6379 --name flowpost-redis redis:latest

# Verify
docker exec flowpost-redis redis-cli ping
```

### Option C: Redis Cloud (Free Tier)

1. Go to https://redis.com/cloud/
2. Create free account and database
3. Get connection string (format: `redis://default:password@host:port`)
4. Update `.env` with connection details

---

## Step 2: Configure Environment Variables

### Edit `backend/.env`

```env
# ============================================
# Redis Configuration
# ============================================
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# For Redis Cloud, use:
# REDIS_URL=redis://default:your-password@your-host:your-port

# ============================================
# Queue Configuration
# ============================================
MAX_CONCURRENT_PUBLISHES=5
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY_MS=5000

# ============================================
# Server Configuration
# ============================================
PORT=5000
FRONTEND_ORIGIN=http://localhost:3000
NODE_ENV=development

# ============================================
# Firebase Configuration
# ============================================
FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com
FIREBASE_API_KEY=your-api-key

# ============================================
# OAuth Configuration (Updated to port 5000)
# ============================================
GOOGLE_LOGIN_REDIRECT_URI=http://localhost:5000/auth/google/callback
GOOGLE_YOUTUBE_REDIRECT_URI=http://localhost:5000/connect-platform/google/callback
FACEBOOK_LOGIN_REDIRECT_URI=http://localhost:5000/auth/facebook/callback
FACEBOOK_CONNECT_REDIRECT_URI=http://localhost:5000/connect-platform/facebook/callback
IG_REDIRECT_URI=http://localhost:5000/connect-platform/instagram/callback
TIKTOK_REDIRECT_URI=http://localhost:5000/connect-platform/tiktok/callback
```

---

## Step 3: Verify Installation

### Check Node Modules

```bash
cd backend

# Verify all dependencies are installed
npm ls winston socket.io bull ioredis

# Should show all packages with versions
```

### Test Redis Connection

```bash
# Test from Node.js
node -e "const Redis = require('ioredis'); const r = new Redis(); r.ping().then(() => console.log('✅ Redis connected!'));"

# Or use redis-cli
redis-cli -h 127.0.0.1 -p 6379 ping
```

---

## Step 4: Start the Server

```bash
cd backend

# Start the server
node server.js

# Expected output:
# FlowPost API on http://localhost:5000
# WebSocket server ready for real-time updates
```

Keep this terminal open for testing.

---

## Step 5: Run Test Suites

### Open a new terminal window and navigate to backend directory

```bash
cd backend
```

### Test 1: System Diagnostics

```bash
# Comprehensive system test
node test-queue-system.js

# Tests:
# ✅ Redis connection
# ✅ Server health
# ✅ Authentication
# ✅ Rate limiting
# ✅ Queue system
# ✅ WebSocket connection
# ✅ Bulk publishing
# ✅ Real-time updates
# ✅ Retry logic
# ✅ Concurrency
```

### Test 2: Bulk Publishing Simulation

```bash
# Simulate 5 posts being published
node test-bulk-publishing.js 5

# Expected output:
# 📢 Simulating 5 bulk posts...
# 📤 Publishing post 1/5: post_bulk_...
# 📋 [job-123] Queued: Post queued for publishing
# ▶️  [job-123] Started: Started publishing to platforms
# ⏳ [job-123] Progress: Published to 2 platforms
# ✅ [job-123] Completed in 1234ms
```

---

## Step 6: Frontend Integration

### Add to Your HTML

```html
<!DOCTYPE html>
<html>
<head>
    <!-- Include Socket.IO client (already in index.html) -->
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    
    <!-- Include Publishing Dashboard -->
    <script src="publishingDashboard.js"></script>
    <script src="DASHBOARD_INTEGRATION.js"></script>
</head>
<body>
    <!-- Your content -->
    <div id="connection-status" class="status-indicator">🔴 Disconnected</div>
    <div id="active-jobs" class="jobs-container"></div>
</body>
</html>
```

### Initialize Dashboard in JavaScript

```javascript
// Initialize after user logs in
const dashboard = new PublishingDashboard('http://localhost:5000');

// Connect to WebSocket
dashboard.connect(authToken).then(() => {
    console.log('✅ Dashboard connected!');
    
    // Listen for events
    dashboard.on('jobQueued', (data) => {
        console.log('📋 Job queued:', data);
        // Update UI
    });
    
    dashboard.on('jobCompleted', (data) => {
        console.log('✅ Job completed:', data);
        // Update UI
    });
});

// Publish a post
document.getElementById('publish-btn').addEventListener('click', async () => {
    try {
        const result = await fetch('http://localhost:5000/publish-post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                postId: 'post-123',
                targets: ['facebook', 'instagram']
            })
        });
        
        const data = await result.json();
        console.log('Job queued:', data.queueId);
        // Real-time updates will come via WebSocket
    } catch (error) {
        console.error('Error:', error);
    }
});
```

---

## Step 7: Monitor Real-Time Updates

### Dashboard Features

The `PublishingDashboard` class provides:

1. **Real-time Job Updates**
   - Queue status notifications
   - Processing progress
   - Platform-specific results
   - Error handling with retry info

2. **Job Management**
   - Track active jobs
   - Get job status
   - Clear completed jobs
   - Subscribe/unsubscribe from updates

3. **Event Listeners**
   - `jobQueued` - Post added to queue
   - `jobStarted` - Processing started
   - `jobProgress` - Real-time progress updates
   - `jobCompleted` - Successfully published
   - `jobFailed` - Publishing failed
   - `jobRetrying` - Automatic retry scheduled

### Example: Custom Dashboard UI

```javascript
// Create custom dashboard
function setupPublishingDashboard() {
    const dashboard = new PublishingDashboard('http://localhost:5000');
    
    // Connect
    dashboard.connect(authToken);
    
    // Listen for all events
    dashboard.on('jobQueued', updateUI);
    dashboard.on('jobStarted', updateUI);
    dashboard.on('jobProgress', updateProgressBar);
    dashboard.on('jobCompleted', showSuccess);
    dashboard.on('jobFailed', showError);
    
    // Update UI when job state changes
    function updateUI(data) {
        const jobElement = document.getElementById(`job-${data.jobId}`);
        jobElement.setAttribute('data-status', data.status);
        jobElement.querySelector('.message').textContent = data.message;
    }
    
    function updateProgressBar(data) {
        const progress = Math.round((data.progress || 0) * 100);
        document.getElementById(`progress-${data.jobId}`).style.width = `${progress}%`;
    }
    
    function showSuccess(data) {
        alert(`✅ Published! Results: ${JSON.stringify(data.results)}`);
    }
    
    function showError(data) {
        alert(`❌ Failed: ${data.error}`);
    }
}
```

---

## Step 8: Performance Monitoring

### Check Queue Status

```bash
# Get Redis queue information
redis-cli

# In Redis CLI:
> INFO stats
> KEYS *
> LLEN bull:flowpost-publish:*
```

### Monitor Server Logs

The server logs all queue operations:

```
[INFO] Enqueued publish job job_xxx for user uid, post postId
[INFO] Processing job job_xxx for user uid
[INFO] Job job_xxx completed successfully
[WARN] Scheduled retry for job job_xxx, attempt 1
```

### Check Active Connections

```bash
# Monitor WebSocket connections
netstat -ano | findstr 5000
```

---

## Troubleshooting

### Redis Connection Issues

```
Error: connect ECONNREFUSED 127.0.0.1:6379

Solution:
1. Verify Redis is running: redis-cli ping
2. Check REDIS_HOST and REDIS_PORT in .env
3. Check firewall settings
```

### WebSocket Connection Failed

```
Error: Proxy connection error

Solution:
1. Ensure server is running on port 5000
2. Check FRONTEND_ORIGIN in .env
3. Verify browser console for CORS errors
```

### Queue Jobs Stuck

```
Solution:
1. Restart Redis: redis-cli FLUSHDB (⚠️ Clears all data)
2. Restart server: node server.js
3. Check LOG files: tail logs/combined.log
```

### Rate Limiting Issues

```
Error: Too many requests (429)

Solution:
1. Adjust MAX_CONCURRENT_PUBLISHES in .env
2. Increase RETRY_DELAY_MS
3. Monitor API usage patterns
```

---

## Production Deployment

### Before Going Live

1. ✅ Run all tests and verify 100% pass rate
2. ✅ Configure Redis for persistence (RDB snapshots)
3. ✅ Set up monitoring and alerting
4. ✅ Enable authentication on Redis
5. ✅ Use environment-specific .env files
6. ✅ Set up log rotation
7. ✅ Configure automatic backups

### Production Configuration

```env
# Use Redis Cloud for better reliability
REDIS_URL=redis://default:strong-password@prod-host:6379

# Increase concurrency for production
MAX_CONCURRENT_PUBLISHES=20
MAX_RETRY_ATTEMPTS=5
RETRY_DELAY_MS=10000

# Production security
NODE_ENV=production
JWT_SECRET=your-strong-secret-key
```

---

## API Endpoints

### Publishing

```
POST /publish-post
- Queues a post for publishing
- Returns: { success: true, queueId: "job-123" }

POST /publish-post/retry
- Retries publishing to specific platforms
- Params: { postId, targets: ["facebook", "instagram"] }

GET /publish-post/queue
- Gets user's queue status
- Returns: { queue: [...jobs] }

POST /publish-post/retry-failed
- Retries failed posts
- Params: { postIds: ["post-1", "post-2"] }

POST /publish-post/cancel
- Cancels queued items
- Params: { itemIds: ["job-1", "job-2"] }
```

---

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review server logs in `backend/logs/`
3. Test with `test-queue-system.js` to identify problems
4. Check Redis status with `redis-cli INFO`

---

## Next Steps

1. ✅ Set up Redis
2. ✅ Configure environment variables
3. ✅ Integrate frontend dashboard
4. ✅ Run test suites
5. → Deploy to production
6. → Monitor and scale as needed
