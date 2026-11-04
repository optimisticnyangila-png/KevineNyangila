import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-storage.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';

import { API_BASE, apiFetch } from './js/api.js';
import { showNotification } from './js/notifications.js';
import { initWebSocket } from './js/websocket.js';
import * as ui from './js/ui.js';
import * as authModule from './js/auth.js';
import * as postsModule from './js/posts.js';

// --- Firebase Configuration ---
const runtimeConfig = window.__FLOWPOST_CONFIG__ || {};
const firebaseApiKey = runtimeConfig.API_KEY || runtimeConfig.FIREBASE_API_KEY;

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

// --- State ---
let lastCreatedPostId = null;
let editingPostId = null;

// --- Dashboard Initialization ---
async function showDashboard() {
    initWebSocket({
        loadPlatformAccounts,
        loadQueueStatus: () => console.log('Queue status refresh requested')
    });

    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    await loadPlatformAccounts();
    await loadDraftPosts();
    await loadScheduledPosts();
    await refreshActivePostSelect();
}

// --- Platform & Account Management ---
async function loadPlatformAccounts() {
    try {
        const response = await apiFetch(`${API_BASE}/platforms/platform-accounts`);
        const data = await response.json();
        if (!response.ok) return;
        ui.renderAccountCheckboxes(data.accounts || [], data.grouped || {});
        ui.updatePlatformSummary(data.accounts || []);
    } catch (error) {
        console.error('Error loading platform accounts:', error);
    }
}

// --- Post Management ---
async function loadDraftPosts() {
    try {
        const posts = await postsModule.loadDraftPosts();
        const list = document.getElementById('drafts-list');
        list.innerHTML = '';
        if (posts.length === 0) {
            list.innerHTML = '<li>No drafts yet</li>';
            return;
        }
        posts.forEach((post) => {
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
            deleteButton.addEventListener('click', () => handleDeletePost(post.id));
            li.appendChild(deleteButton);

            list.appendChild(li);
        });
    } catch (e) {
        document.getElementById('drafts-list').innerHTML = '<li>Error loading drafts</li>';
    }
}

async function loadScheduledPosts() {
    try {
        const posts = await postsModule.loadScheduledPosts();
        const list = document.getElementById('posts-list');
        list.innerHTML = '';
        if (posts.length === 0) {
            list.innerHTML = '<li>No scheduled posts</li>';
            return;
        }
        posts.forEach((post) => {
            const li = document.createElement('li');
            const when = post.scheduledTime ? new Date(post.scheduledTime).toLocaleString() : '';
            li.textContent = `${post.id}: ${when} — ${post.content || ''}`;

            const cancelButton = document.createElement('button');
            cancelButton.textContent = 'Cancel';
            cancelButton.addEventListener('click', () => handleUnschedulePost(post.id));
            li.appendChild(cancelButton);

            list.appendChild(li);
        });
    } catch (e) {
        document.getElementById('posts-list').innerHTML = '<li>Error loading scheduled posts</li>';
    }
}

async function refreshActivePostSelect() {
    const sel = document.getElementById('active-post');
    sel.innerHTML = '';
    try {
        const posts = await postsModule.loadDraftPosts();
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

function editPost(post) {
    editingPostId = post.id;
    document.getElementById('post-content').value = post.content || '';
    const checkboxes = document.querySelectorAll('.account-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = (post.targets || []).includes(cb.value);
    });
    document.getElementById('create-post-btn').textContent = 'Save Post';
    document.getElementById('cancel-edit-btn').classList.remove('hidden');
    document.getElementById('active-post').value = post.id;
}

function clearEditingMode() {
    editingPostId = null;
    document.getElementById('post-content').value = '';
    document.getElementById('media-upload').value = '';
    document.querySelectorAll('.account-checkbox').forEach(cb => cb.checked = false);
    document.getElementById('create-post-btn').textContent = 'Create Post';
    document.getElementById('cancel-edit-btn').classList.add('hidden');
}

async function handleDeletePost(postId) {
    if (!confirm('Delete this draft post?')) return;
    try {
        await postsModule.deletePost(postId);
        showNotification('Draft post deleted.', 'success');
        await loadDraftPosts();
        await loadScheduledPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
}

async function handleUnschedulePost(postId) {
    if (!confirm('Cancel this scheduled post?')) return;
    try {
        await postsModule.unschedulePost(postId);
        showNotification('Scheduled post canceled.', 'success');
        await loadScheduledPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
}

async function handleRetryPublish(postId, targets) {
    try {
        const response = await apiFetch(`${API_BASE}/publish-post/retry`, {
            method: 'POST',
            body: JSON.stringify({ postId, targets }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Retry failed');
        ui.showPublishResults(postId, data.result || {}, handleRetryPublish);
    } catch (error) {
        alert(error.message);
    }
}

// --- Event Listener Safe Helper ---
function addClickListener(id, handler) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('click', handler);
    }
}

// --- Event Listeners ---
addClickListener('email-login', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const data = await authModule.login(email, password);
        showNotification(data.message || 'Login successful', 'success');
        showDashboard();
    } catch (error) {
        alert(error.message);
    }
});

addClickListener('email-signup', async () => {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    try {
        const data = await authModule.signup(email, password);
        showNotification(data.message || 'Signup successful', 'success');
        showDashboard();
    } catch (error) {
        alert(error.message);
    }
});

addClickListener('logout', authModule.logout);
addClickListener('google-login', authModule.handleGoogleLogin);
addClickListener('facebook-login', authModule.handleFacebookLogin);
addClickListener('google-signup', authModule.handleGoogleLogin);
addClickListener('facebook-signup', authModule.handleFacebookLogin);
addClickListener('signup', ui.showRegister);
addClickListener('show-login-link', (e) => { e.preventDefault(); ui.showLogin(); });
addClickListener('show-login-from-register', (e) => { e.preventDefault(); ui.showLogin(); });
addClickListener('cancel-edit-btn', clearEditingMode);
addClickListener('close-results-btn', () => document.getElementById('publish-results').classList.add('hidden'));

addClickListener('connect-facebook', () => window.location.href = `${API_BASE}/connect-platform/facebook/authorize`);
addClickListener('connect-instagram', () => window.location.href = `${API_BASE}/connect-platform/instagram/authorize`);
addClickListener('connect-tiktok', () => window.location.href = `${API_BASE}/connect-platform/tiktok/authorize`);
addClickListener('connect-youtube', () => window.location.href = `${API_BASE}/connect-platform/youtube/authorize`);

addClickListener('create-post-btn', async () => {
    const content = document.getElementById('post-content').value;
    const media = document.getElementById('media-upload').files;
    const accounts = ui.getSelectedAccounts();

    if (accounts.length === 0) {
        alert('❌ Please select at least one account to publish to.');
        return;
    }

    const selectedAccountIds = accounts.map(a => a.id);
    const platforms = [...new Set(accounts.map(a => a.platform))];

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
        const data = await postsModule.savePost(editingPostId, {
            content,
            mediaUrls,
            targets: selectedAccountIds,
            platforms
        });

        showNotification(editingPostId ? 'Post updated' : 'Post created', 'success');
        if (!editingPostId) lastCreatedPostId = data.postId;

        clearEditingMode();
        await loadDraftPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
});

addClickListener('schedule-post-btn', async () => {
    const postId = document.getElementById('active-post').value || lastCreatedPostId;
    const raw = document.getElementById('schedule-time').value;
    if (!postId || !raw) {
        alert('Select a post and pick a date/time.');
        return;
    }

    const scheduledTime = new Date(raw);
    if (scheduledTime <= new Date()) {
        alert('Cannot schedule posts in the past.');
        return;
    }

    try {
        await postsModule.schedulePost(postId, scheduledTime.toISOString());
        showNotification('Post scheduled successfully!', 'success');
        document.getElementById('schedule-time').value = '';
        await loadScheduledPosts();
        await refreshActivePostSelect();
    } catch (error) {
        alert(error.message);
    }
});

addClickListener('publish-now-btn', async () => {
    const postId = document.getElementById('active-post').value || lastCreatedPostId;
    if (!postId) {
        alert('Select a post first.');
        return;
    }
    try {
        const data = await postsModule.publishPostNow(postId);
        ui.showPublishResults(postId, data.result || {}, handleRetryPublish);
        await loadScheduledPosts();
    } catch (error) {
        alert(error.message);
    }
});

// --- Initialization ---
window.addEventListener('load', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const pathname = window.location.pathname;

    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
        localStorage.setItem('token', tokenFromUrl);
        urlParams.delete('token');
        const newSearch = urlParams.toString();
        const newUrl = pathname + (newSearch ? `?${newSearch}` : '');
        window.history.replaceState({}, document.title, newUrl);
    }

    const oauthError = urlParams.get('error');
    if (oauthError) {
        alert(`OAuth error: ${oauthError}`);
        window.history.replaceState({}, document.title, pathname);
        ui.showLogin();
        return;
    }

    const platformConnected = ['youtube', 'facebook', 'instagram', 'tiktok'].find((p) => urlParams.get(p) === 'connected');
    if (platformConnected) {
        window.history.replaceState({}, document.title, pathname);
        showNotification(`${platformConnected} connected successfully.`, 'success');
    }

    if (await authModule.isSessionValid()) {
        showDashboard();
    } else {
        ui.showLogin();
    }
});
