import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js';
import { getAuth, FacebookAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';

const runtimeConfig = window.__FLOWPOST_CONFIG__ || {};
const firebaseApiKey = runtimeConfig.API_KEY || runtimeConfig.FIREBASE_API_KEY;

if (!firebaseApiKey) {
    console.error('Missing Firebase API key. Set API_KEY in frontend/.env or the server environment.');
}

const firebaseConfig = {
    apiKey: firebaseApiKey,
    authDomain: 'flowpost-13ca6.firebaseapp.com',
    projectId: 'flowpost-13ca6',
    storageBucket: 'flowpost-13ca6.firebasestorage.app',
    messagingSenderId: '793990712579',
    appId: '1:793990712579:web:c7908e9ce645f57261ed36',
    measurementId: 'G-490522HEBE',
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const auth = getAuth(app);

const DEFAULT_API_BASE = 'https://flowpost-backed.onrender.com';
const apiBaseMeta = document.querySelector('meta[name="api-base"]')?.content;
const API_BASE = (runtimeConfig.API_BASE || apiBaseMeta || DEFAULT_API_BASE).replace(/\/$/, '');

// WebSocket connection for real-time updates
let socket = null;

function initWebSocket() {
    const token = localStorage.getItem('token');
    if (!token) return;

    socket = io(API_BASE, {
        auth: { token }
    });

    socket.on('connect', () => {
        console.log('Connected to real-time updates');
        showNotification('Connected to live updates', 'success');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from real-time updates');
        showNotification('Disconnected from live updates', 'warning');
    });

    socket.on('publish:update', (data) => {
        handlePublishUpdate(data);
    });

    socket.on('queue:update', (data) => {
        handleQueueUpdate(data);
    });

    socket.on('account:update', (data) => {
        handleAccountUpdate(data);
    });

    socket.on('bulk:progress', (data) => {
        handleBulkProgress(data);
    });
}

function handlePublishUpdate(data) {
    const { postId, status, message, results, queueId } = data;

    // Update UI based on status
    switch (status) {
        case 'queued':
            showNotification(`Post queued for publishing: ${message}`, 'info');
            break;
        case 'processing':
            showNotification(`Publishing in progress: ${message}`, 'info');
            updatePublishStatus(postId, 'processing', results);
            break;
        case 'progress':
            updatePublishStatus(postId, 'progress', results);
            break;
        case 'completed':
            showNotification('Publishing completed successfully!', 'success');
            updatePublishStatus(postId, 'completed', results);
            break;
        case 'failed':
            showNotification(`Publishing failed: ${message}`, 'error');
            updatePublishStatus(postId, 'failed', results);
            break;
        case 'retry_scheduled':
            showNotification(`Publishing failed, retry scheduled: ${message}`, 'warning');
            break;
    }
}

function handleQueueUpdate(data) {
    const { action, message } = data;
    showNotification(`Queue update: ${message}`, 'info');

    // Refresh queue status if queue UI is visible
    if (document.getElementById('queue-status') && typeof loadQueueStatus === 'function') {
        loadQueueStatus();
    }
}

function handleAccountUpdate(data) {
    showNotification(`Account update: ${data.message}`, 'info');
    // Refresh account status
    loadPlatformAccounts();
}

function handleBulkProgress(data) {
    const { operationId, progress, message } = data;
    showNotification(`Bulk operation progress: ${message}`, 'info');
}

function updatePublishStatus(postId, status, results) {
    const resultsDiv = document.getElementById('publish-results');
    const resultsList = document.getElementById('publish-results-list');
    if (!resultsDiv || !resultsList || !results) return;

    resultsList.innerHTML = '';
    for (const [targetId, result] of Object.entries(results)) {
        const item = document.createElement('p');
        item.textContent = `${targetId}: ${result.success ? 'Success' : result.error || 'Failed'}`;
        item.className = result.success ? 'success' : 'error';
        resultsList.appendChild(item);
    }

    const heading = resultsDiv.querySelector('h3');
    if (heading) {
        heading.textContent = `Publish Status: ${status}`;
    }
    resultsDiv.classList.remove('hidden');
}

/** All API calls send the Firebase ID token if available, plus credentials for cookies. */
function apiFetch(url, options = {}) {
    const { headers: hdr, ...rest } = options;
    const headers = {...hdr };
    const token = localStorage.getItem('token');

    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, {
        ...rest,
        headers,
        credentials: 'include',
    });
}

let lastCreatedPostId = null;
let editingPostId = null;
let platformStatusCache = {};

function showNotification(message, type = 'info') {
    let container = document.getElementById('notifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notifications';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }

    const notice = document.createElement('div');
    notice.className = `notification notification-${type}`;
    notice.textContent = message;
    container.appendChild(notice);

    window.setTimeout(() => {
        notice.remove();
        if (!container.children.length) {
            container.remove();
        }
    }, 5000);
}

function showLogin() {
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

function showRegister() {
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

async function showDashboard() {
    // Initialize WebSocket connection for real-time updates
    initWebSocket();
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    await loadPlatformAccounts(); // UPDATED: Load accounts instead of platforms
    await loadDraftPosts();
    await loadScheduledPosts();
    await refreshActivePostSelect();
}

function displayCommandOutput(message, isError = false) {
    const output = document.getElementById('command-output');
    output.textContent = message;
    output.classList.toggle('error', isError);
    output.classList.remove('hidden');
}

function clearCommandOutput() {
    const output = document.getElementById('command-output');
    output.textContent = '';
    output.classList.add('hidden');
}

function renderPlatformStatus(platforms) {
    const statusList = document.getElementById('platform-status-list');
    statusList.innerHTML = '';

    Object.entries(platforms).forEach(([name, data]) => {
        const li = document.createElement('li');
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        const status = data.connected ? 'Connected' : 'Not connected';
        let details = status;

        if (data.connected) {
            if (data.selectedPageId) {
                details += ` — Selected page: ${data.selectedPageId}`;
            } else if (data.selectedAccountId) {
                details += ` — Selected account: ${data.selectedAccountId}`;
            } else if (data.selectedChannelId) {
                details += ` — Selected channel: ${data.selectedChannelId}`;
            } else if (data.account && data.account.id) {
                details += ` — Connected account: ${data.account.id}`;
            }
        }

        li.textContent = `${label}: ${details}`;
        statusList.appendChild(li);
    });
}

// ===== NEW: Multi-Account System =====

async function loadPlatformAccounts() {
    try {
        const response = await apiFetch(`${API_BASE}/platforms/platform-accounts`);
        const data = await response.json();
        if (!response.ok) {
            console.warn('Unable to load platform accounts:', data.error);
            return;
        }
        renderAccountCheckboxes(data.accounts || [], data.grouped || {});
        updatePlatformSummary(data.accounts || []);
    } catch (error) {
        console.error('Error loading platform accounts:', error);
    }
}

function renderAccountCheckboxes(accounts, grouped) {
    const container = document.getElementById('account-selection-container');
    if (!container) return;

    container.innerHTML = '';
    if (accounts.length === 0) {
        container.innerHTML = '<p style="color: #999;">No connected accounts. Connect a platform to get started.</p>';
        return;
    }

    const platforms = ['facebook', 'instagram', 'youtube', 'tiktok'];
    platforms.forEach(platform => {
        const platformAccounts = grouped[platform] || [];
        if (platformAccounts.length === 0) return;

        const section = document.createElement('div');
        section.style.marginBottom = '15px';
        section.style.padding = '10px';
        section.style.backgroundColor = '#f5f5f5';
        section.style.borderRadius = '4px';

        const header = document.createElement('h4');
        header.textContent = `${platform.toUpperCase()} (${platformAccounts.length})`;
        header.style.margin = '0 0 10px 0';
        section.appendChild(header);

        platformAccounts.forEach(account => {
            const label = document.createElement('label');
            label.style.display = 'block';
            label.style.marginBottom = '8px';
            label.style.cursor = 'pointer';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = account.id;
            checkbox.className = 'account-checkbox';
            checkbox.dataset.platform = account.platform;
            checkbox.dataset.accountName = account.accountName;

            const statusBadge = account.status === 'expired' ? ' ⚠️ Expired' : ' ✓ Active';
            const statusColor = account.status === 'expired' ? '#d32f2f' : '#4caf50';
            label.innerHTML = `${checkbox.outerHTML}<span style="margin-left: 8px;">${account.accountName} <span style="color: ${statusColor}; font-size: 0.9em;">${statusBadge}</span></span>`;
            section.appendChild(label);
        });

        container.appendChild(section);
    });
}

function updatePlatformSummary(accounts) {
    const summary = {};
    accounts.forEach(acc => {
        if (!summary[acc.platform]) summary[acc.platform] = 0;
        summary[acc.platform]++;
    });

    const statusEl = document.getElementById('platform-status-list');
    if (!statusEl) return;

    statusEl.innerHTML = '';
    Object.entries(summary).forEach(([platform, count]) => {
        const li = document.createElement('li');
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);
        li.textContent = `${label} → ${count} account${count !== 1 ? 's' : ''} connected`;
        li.style.padding = '8px';
        li.style.marginBottom = '4px';
        li.style.backgroundColor = '#e8f5e9';
        li.style.borderRadius = '4px';
        statusEl.appendChild(li);
    });
}

function showPublishResults(postId, results) {
    const resultsDiv = document.getElementById('publish-results');
    const resultsList = document.getElementById('publish-results-list');
    resultsList.innerHTML = '';

    Object.entries(results).forEach(([accountId, result]) => {
        const li = document.createElement('li');
        li.style.padding = '8px';
        li.style.marginBottom = '8px';
        li.style.borderRadius = '4px';

        if (result.success) {
            li.style.backgroundColor = '#e8f5e9';
            li.innerHTML = `✓ <strong>${result.accountName}</strong> (${result.platform}) - Published successfully`;
        } else {
            li.style.backgroundColor = '#ffebee';
            li.innerHTML = `✗ <strong>${result.accountName || accountId}</strong> - ${result.error}`;

            if (!result.requiresReauth) {
                const retryBtn = document.createElement('button');
                retryBtn.textContent = 'Retry';
                retryBtn.style.marginLeft = '10px';
                retryBtn.addEventListener('click', () => retryPublish(postId, [accountId]));
                li.appendChild(retryBtn);
            } else {
                const reauthNote = document.createElement('span');
                reauthNote.textContent = ' (Re-auth required)';
                reauthNote.style.color = '#d32f2f';
                li.appendChild(reauthNote);
            }
        }

        resultsList.appendChild(li);
    });

    resultsDiv.classList.remove('hidden');
}

async function retryPublish(postId, targets) {
    try {
        const response = await apiFetch(`${API_BASE}/publish-post/retry`, {
            method: 'POST',
            body: JSON.stringify({ postId, targets }),
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Retry failed');
            return;
        }

        // Update results
        showPublishResults(postId, data.result || {});
    } catch (error) {
        alert(error.message);
    }
}

document.getElementById('close-results-btn').addEventListener('click', () => {
    document.getElementById('publish-results').classList.add('hidden');
});

// ===== OLD: Deprecated =====
async function loadPlatformStatus() {
    try {
        const response = await apiFetch(`${API_BASE}/platforms`);
        const data = await response.json();
        if (!response.ok) {
            console.warn('Unable to load platform status:', data.error);
            return;
        }
        platformStatusCache = data.platforms || {};
        renderPlatformStatus(platformStatusCache);
    } catch (error) {
        console.error('Error loading platform status:', error);
    }
}

function parseCommand(text) {
    const normalized = text.trim();
    if (!normalized) return null;

    const corePattern = /^\/(login|register|help|create|publish|schedule|connect|logout)(\s.*)?$/i;
    const isSlashCommand = corePattern.test(normalized);

    if (isSlashCommand) {
        if (/^\/login$/i.test(normalized)) return { type: 'LOGIN' };
        if (/^\/register$/i.test(normalized)) return { type: 'REGISTER' };
        if (/^\/help$/i.test(normalized)) return { type: 'HELP' };
        if (/^\/logout$/i.test(normalized)) return { type: 'LOGOUT' };

        const createMatch = normalized.match(/^\/create\s+post\s*(.*)?$/i);
        if (createMatch) {
            return { type: 'CREATE', content: createMatch[1] ? createMatch[1].trim() : '' };
        }

        const publishMatch = normalized.match(/^\/publish\s+(\d+)$/i);
        if (publishMatch) {
            return { type: 'PUBLISH', postId: publishMatch[1] };
        }

        const scheduleMatch = normalized.match(/^\/schedule\s+(\d+)\s+at\s+(.+)$/i);
        if (scheduleMatch) {
            return {
                type: 'SCHEDULE',
                postId: scheduleMatch[1],
                time: scheduleMatch[2].trim(),
            };
        }

        const connectMatch = normalized.match(/^\/connect\s+(facebook|google|youtube|tiktok|instagram)$/i);
        if (connectMatch) {
            return { type: 'CONNECT', platform: connectMatch[1].toLowerCase() };
        }

        return { type: 'UNKNOWN' };
    }

    // Optional natural language fallback
    if (/(create|make|write).*(post|content)/i.test(normalized)) {
        return { type: 'CREATE', content: normalized };
    }
    if (/(publish|post).*\d+/i.test(normalized)) {
        const idMatch = normalized.match(/(\d+)/);
        return idMatch ? { type: 'PUBLISH', postId: idMatch[1] } : { type: 'UNKNOWN' };
    }
    if (/(login|sign in|log in)/i.test(normalized)) return { type: 'LOGIN' };
    if (/(register|sign up)/i.test(normalized)) return { type: 'REGISTER' };

    return { type: 'UNKNOWN' };
}

async function executeCommand(commandText) {
    clearCommandOutput();
    const parsed = parseCommand(commandText);
    if (!parsed) {
        displayCommandOutput('Please enter a command or type /help.', true);
        return;
    }

    switch (parsed.type) {
        case 'LOGIN':
            showLogin();
            displayCommandOutput('Showing login screen.');
            break;
        case 'REGISTER':
            showRegister();
            displayCommandOutput('Showing register screen.');
            break;
        case 'HELP':
            displayCommandOutput('Commands:\n/login\n/register\n/create post <text>\n/publish <postId>\n/schedule <postId> at <YYYY-MM-DD HH:MM>\n/connect <facebook|google|youtube|tiktok|instagram>\n/logout');
            break;
        case 'LOGOUT':
            await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
            localStorage.removeItem('token');
            showLogin();
            displayCommandOutput('Logged out successfully.');
            break;
        case 'CREATE':
            {
                if (!document.getElementById('dashboard').classList.contains('hidden')) {
                    const content = parsed.content || document.getElementById('post-content').value || 'New post created via command.';
                    const response = await apiFetch(`${API_BASE}/create-post`, {
                        method: 'POST',
                        body: JSON.stringify({ content, mediaUrls: [], platforms: [] }),
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        displayCommandOutput(data.error || 'Create post failed.', true);
                        return;
                    }
                    lastCreatedPostId = data.postId;
                    await loadDraftPosts();
                    await refreshActivePostSelect();
                    displayCommandOutput(`Post created: ${data.postId}`);
                } else {
                    displayCommandOutput('You must be on the dashboard to create a post. Please /login first.', true);
                }
                break;
            }
        case 'PUBLISH':
            {
                if (!document.getElementById('dashboard').classList.contains('hidden')) {
                    const response = await apiFetch(`${API_BASE}/publish-post`, {
                        method: 'POST',
                        body: JSON.stringify({ postId: parsed.postId }),
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        displayCommandOutput(data.error || 'Publish failed.', true);
                        return;
                    }
                    displayCommandOutput(`Publish result: ${JSON.stringify(data)}`);
                } else {
                    displayCommandOutput('You must be on the dashboard to publish a post. Please /login first.', true);
                }
                break;
            }
        case 'SCHEDULE':
            {
                if (!document.getElementById('dashboard').classList.contains('hidden')) {
                    const scheduledTime = new Date(parsed.time);
                    if (Number.isNaN(scheduledTime.getTime())) {
                        displayCommandOutput('Invalid schedule time. Use format YYYY-MM-DD HH:MM.', true);
                        return;
                    }
                    const response = await apiFetch(`${API_BASE}/schedule-post`, {
                        method: 'POST',
                        body: JSON.stringify({ postId: parsed.postId, scheduledTime: scheduledTime.toISOString() }),
                    });
                    const data = await response.json();
                    if (!response.ok) {
                        displayCommandOutput(data.error || 'Schedule failed.', true);
                        return;
                    }
                    await loadScheduledPosts();
                    displayCommandOutput(`Post ${parsed.postId} scheduled for ${scheduledTime.toLocaleString()}.`);
                } else {
                    displayCommandOutput('You must be on the dashboard to schedule a post. Please /login first.', true);
                }
                break;
            }
        case 'CONNECT':
            {
                if (!document.getElementById('dashboard').classList.contains('hidden')) {
                    window.location.href = `${API_BASE}/connect-platform/${parsed.platform}/authorize`;
                } else {
                    displayCommandOutput('You must be on the dashboard to connect a platform. Please /login first.', true);
                }
                break;
            }
        default:
            displayCommandOutput('Command not recognized. Type /help for supported commands.', true);
    }
}


async function isSessionValid() {
    const r = await apiFetch(`${API_BASE}/auth/verify`);
    if (r.ok) {
        const data = await r.json();
        if (data.success && data.token) {
            localStorage.setItem('token', data.token);
        }
        return true;
    }
    return false;
}

async function exchangeFirebaseIdToken(idToken) {
    const response = await apiFetch(`${API_BASE}/auth/firebase`, {
        method: 'POST',
        body: JSON.stringify({ idToken }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Firebase auth failed');
    showDashboard();
}

document.getElementById('show-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
});

document.getElementById('show-login-from-register').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
});

document.getElementById('google-login').addEventListener('click', () => {
    window.location.href = `${API_BASE}/auth/google`;
});

document.getElementById('facebook-login').addEventListener('click', () => {
    window.location.href = `${API_BASE}/auth/facebook`;
});

document.getElementById('google-signup').addEventListener('click', () => {
    window.location.href = `${API_BASE}/auth/google`;
});

document.getElementById('facebook-signup').addEventListener('click', () => {
    window.location.href = `${API_BASE}/auth/facebook`;
});

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    clearEditingMode();
});

document.getElementById('email-login').addEventListener('click', async() => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    localStorage.removeItem('token');
    try {
        const response = await apiFetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (response.ok && data.success) {
            localStorage.setItem('token', data.token);
            alert(data.message + '\n\nLoading your dashboard and syncing connected platforms...');
            showDashboard();
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (error) {
        alert('Login failed. Please check your credentials or try logging in with Google or Facebook.');
    }
});

document.getElementById('signup').addEventListener('click', () => {
    showRegister();
});

document.getElementById('email-signup').addEventListener('click', async() => {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    localStorage.removeItem('token');
    try {
        const response = await apiFetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (response.ok && data.success) {
            localStorage.setItem('token', data.token);
            alert(data.message + '\n\nRedirecting you to your dashboard...');
            showDashboard();
        } else {
            alert(data.error || 'Registration failed');
        }
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('logout').addEventListener('click', async() => {
    try {
        await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (_) {
        /* ignore */
    }
    localStorage.removeItem('token');
    showLogin();
});

// Platform OAuth: all client IDs / secrets live in backend .env — browser only navigates to backend routes.
document.getElementById('connect-facebook').addEventListener('click', () => {
    window.location.href = `${API_BASE}/connect-platform/facebook/authorize`;
});

document.getElementById('connect-instagram').addEventListener('click', () => {
    window.location.href = `${API_BASE}/connect-platform/instagram/authorize`;
});

document.getElementById('connect-tiktok').addEventListener('click', () => {
    window.location.href = `${API_BASE}/connect-platform/tiktok/authorize`;
});

document.getElementById('connect-youtube').addEventListener('click', () => {
    window.location.href = `${API_BASE}/connect-platform/youtube/authorize`;
});

window.addEventListener('load', async() => {
    const urlParams = new URLSearchParams(window.location.search);
    const pathname = window.location.pathname;

    const oauthError = urlParams.get('error');
    if (oauthError) {
        alert(`OAuth error: ${oauthError}`);
        window.history.replaceState({}, document.title, pathname);
        showLogin();
        return;
    }

    const platformConnected = ['youtube', 'facebook', 'instagram', 'tiktok'].find((p) => urlParams.get(p) === 'connected');
    if (platformConnected) {
        window.history.replaceState({}, document.title, pathname);
        alert(`${platformConnected.charAt(0).toUpperCase() + platformConnected.slice(1)} connected successfully.`);
    }

    if (await isSessionValid()) {
        // Check if this is a redirect from OAuth login
        if (pathname.includes('dashboard') || urlParams.has('code') || urlParams.has('state')) {
            alert('Login successful. Connecting to FlowPost system...\n\nLoading your dashboard and syncing connected platforms...');
        }
        showDashboard();
    } else {
        showLogin();
    }
});

document.getElementById('create-post-btn').addEventListener('click', async() => {
    const content = document.getElementById('post-content').value;
    const media = document.getElementById('media-upload').files;

    // UPDATED: Get selected accounts instead of platforms
    const accounts = getSelectedAccounts();
    if (accounts.length === 0) {
        alert('❌ Please select at least one account to publish to.');
        return;
    }

    const selectedAccountIds = accounts.map(a => a.id);
    const platforms = [...new Set(accounts.map(a => a.platform))];

    const method = editingPostId ? 'PUT' : 'POST';
    const url = editingPostId ? `${API_BASE}/create-post/${editingPostId}` : `${API_BASE}/create-post`;

    let mediaUrls = [];
    if (media.length > 0) {
        for (const file of media) {
            const storageRef = ref(storage, `posts/${Date.now()}_${file.name}`);
            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);
            mediaUrls.push(downloadURL);
        }
    }

    try {
        const response = await apiFetch(url, {
            method,
            body: JSON.stringify({
                content,
                mediaUrls,
                targets: selectedAccountIds, // NEW: Account IDs
                platforms // For backward compatibility
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Unable to save post');
            return;
        }
        if (editingPostId) {
            alert('✓ Post updated successfully.');
        } else {
            lastCreatedPostId = data.postId;
            alert(`✓ Post created: ${data.postId}`);
        }
        clearEditingMode();
        document.getElementById('media-upload').value = '';
        document.getElementById('post-content').value = '';
        await loadDraftPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
});

async function loadDraftPosts() {
    try {
        const response = await apiFetch(`${API_BASE}/create-post`);
        const data = await response.json();
        const list = document.getElementById('drafts-list');
        list.innerHTML = '';
        if (!data.posts || data.posts.length === 0) {
            list.innerHTML = '<li>No drafts yet</li>';
            return;
        }
        data.posts.forEach((post) => {
                    const li = document.createElement('li');
                    const when = post.updatedAt ? new Date(post.updatedAt).toLocaleString() : '';
                    const title = `${post.id}: ${post.content || '(no text)'} — ${(post.platforms || []).join(', ')}`;
                    li.textContent = `${title} ${when ? `(${when})` : ''}`;

            const editButton = document.createElement('button');
            editButton.textContent = 'Edit';
            editButton.addEventListener('click', () => editPost(post));
            li.appendChild(editButton);

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => deletePost(post.id));
            li.appendChild(deleteButton);

            list.appendChild(li);
        });
    } catch (error) {
        console.error('Error loading drafts:', error);
        document.getElementById('drafts-list').innerHTML = '<li>Error loading drafts</li>';
    }
}

async function loadScheduledPosts() {
    try {
        const response = await apiFetch(`${API_BASE}/schedule-post`);
        const data = await response.json();
        const list = document.getElementById('posts-list');
        list.innerHTML = '';
        if (!data.posts || data.posts.length === 0) {
            list.innerHTML = '<li>No scheduled posts</li>';
            return;
        }
        data.posts.forEach((post) => {
            const li = document.createElement('li');
            const when = post.scheduledTime ? new Date(post.scheduledTime).toLocaleString() : '';
            li.textContent = `${post.id}: ${when} — ${post.content || ''}`;

            const cancelButton = document.createElement('button');
            cancelButton.textContent = 'Cancel';
            cancelButton.addEventListener('click', () => unschedulePost(post.id));
            li.appendChild(cancelButton);

            list.appendChild(li);
        });
    } catch (error) {
        console.error('Error loading scheduled posts:', error);
        document.getElementById('posts-list').innerHTML = '<li>Error loading scheduled posts</li>';
    }
}

async function refreshActivePostSelect() {
    const sel = document.getElementById('active-post');
    sel.innerHTML = '';
    try {
        const response = await apiFetch(`${API_BASE}/create-post`);
        const data = await response.json();
        const posts = data.posts || [];
        const unscheduledPosts = posts.filter(p => !p.scheduled);
        unscheduledPosts.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.id}: ${(p.content || '').slice(0, 40)}`;
            sel.appendChild(opt);
        });
        if (lastCreatedPostId && unscheduledPosts.some(p => p.id === lastCreatedPostId)) {
            sel.value = lastCreatedPostId;
        }
    } catch (e) {
        console.error(e);
    }
}

function getSelectedPostId() {
    const sel = document.getElementById('active-post');
    return sel.value || lastCreatedPostId;
}

function setEditingMode(post) {
    editingPostId = post.id;
    document.getElementById('post-content').value = post.content || '';

    // UPDATED: Check checkboxes for selected accounts
    const checkboxes = document.querySelectorAll('.account-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = (post.targets || []).includes(cb.value);
    });

    document.getElementById('create-post-btn').textContent = 'Save Post';
    document.getElementById('cancel-edit-btn').classList.remove('hidden');
}

function clearEditingMode() {
    editingPostId = null;
    document.getElementById('post-content').value = '';
    document.getElementById('media-upload').value = '';

    // UPDATED: Uncheck all account checkboxes
    const checkboxes = document.querySelectorAll('.account-checkbox');
    checkboxes.forEach(cb => cb.checked = false);

    document.getElementById('create-post-btn').textContent = 'Create Post';
    document.getElementById('cancel-edit-btn').classList.add('hidden');
}

async function editPost(post) {
    setEditingMode(post);
    const activeSelect = document.getElementById('active-post');
    activeSelect.value = post.id;
}

async function deletePost(postId) {
    if (!confirm('Delete this draft post?')) return;
    try {
        const response = await apiFetch(`${API_BASE}/create-post/${postId}`, {
            method: 'DELETE',
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Unable to delete post');
            return;
        }
        alert('Draft post deleted.');
        await loadDraftPosts();
        await loadScheduledPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
}

async function unschedulePost(postId) {
    if (!confirm('Cancel this scheduled post?')) return;
    try {
        const response = await apiFetch(`${API_BASE}/schedule-post/${postId}`, {
            method: 'DELETE',
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Unable to cancel scheduled post');
            return;
        }
        alert('Scheduled post canceled.');
        await loadScheduledPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
}

document.getElementById('schedule-post-btn').addEventListener('click', async() => {
    const postId = getSelectedPostId();
    const raw = document.getElementById('schedule-time').value;
    if (!postId) {
        alert('Create a post or select one in the list.');
        return;
    }
    if (!raw) {
        alert('Pick a date and time to schedule.');
        return;
    }

    const scheduledTime = new Date(raw);
    if (scheduledTime <= new Date()) {
        alert('Cannot schedule posts in the past.');
        return;
    }

    const scheduledTimeISO = scheduledTime.toISOString();
    try {
        const response = await apiFetch(`${API_BASE}/schedule-post`, {
            method: 'POST',
            body: JSON.stringify({ postId, scheduledTime: scheduledTimeISO }),
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Schedule failed');
            return;
        }
        alert('Post scheduled successfully!');
        document.getElementById('schedule-time').value = ''; // Clear the input
        await loadScheduledPosts();
        await refreshActivePostSelect(); // Refresh in case we want to schedule again
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById('publish-now-btn').addEventListener('click', async() => {
    const postId = getSelectedPostId();
    if (!postId) {
        alert('Create a post or select one in the list.');
        return;
    }
    try {
        const response = await apiFetch(`${API_BASE}/publish-post`, {
            method: 'POST',
            body: JSON.stringify({ postId }),
        });
        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Publish failed');
            return;
        }
        
        // Show results in UI
        showPublishResults(postId, data.result || {});

        await loadScheduledPosts();
    } catch (error) {
        alert(error.message);
    }
});
