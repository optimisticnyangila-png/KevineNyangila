/**
 * FlowPost WebSocket Module
 * Handles real-time updates via Socket.io
 */

import { API_BASE } from './api.js';
import { showNotification } from './notifications.js';

let socket = null;

export function initWebSocket(callbacks = {}) {
    const token = localStorage.getItem('token');
    if (!token) return;

    // Use global io from script tag in index.html
    socket = window.io(API_BASE, {
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
        handleQueueUpdate(data, callbacks.loadQueueStatus);
    });

    socket.on('account:update', (data) => {
        handleAccountUpdate(data, callbacks.loadPlatformAccounts);
    });

    socket.on('bulk:progress', (data) => {
        handleBulkProgress(data);
    });

    return socket;
}

function handlePublishUpdate(data) {
    const { postId, status, message, results } = data;

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

function handleQueueUpdate(data, refreshFn) {
    showNotification(`Queue update: ${data.message}`, 'info');
    if (typeof refreshFn === 'function') {
        refreshFn();
    }
}

function handleAccountUpdate(data, refreshFn) {
    showNotification(`Account update: ${data.message}`, 'info');
    if (typeof refreshFn === 'function') {
        refreshFn();
    }
}

function handleBulkProgress(data) {
    showNotification(`Bulk operation progress: ${data.message}`, 'info');
}

export function updatePublishStatus(postId, status, results) {
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
