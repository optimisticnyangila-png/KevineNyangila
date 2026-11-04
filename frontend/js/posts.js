/**
 * FlowPost Posts Module
 * Handles creation, loading, and management of posts
 */

import { apiFetch, API_BASE } from './api.js';
import { getSelectedAccounts } from './ui.js';

export async function loadDraftPosts(renderFn) {
    try {
        const response = await apiFetch(`${API_BASE}/create-post`);
        const data = await response.json();
        if (typeof renderFn === 'function') {
            renderFn(data.posts || []);
        }
        return data.posts || [];
    } catch (error) {
        console.error('Error loading drafts:', error);
        throw error;
    }
}

export async function loadScheduledPosts(renderFn) {
    try {
        const response = await apiFetch(`${API_BASE}/schedule-post`);
        const data = await response.json();
        if (typeof renderFn === 'function') {
            renderFn(data.posts || []);
        }
        return data.posts || [];
    } catch (error) {
        console.error('Error loading scheduled posts:', error);
        throw error;
    }
}

export async function savePost(postId, postData) {
    const method = postId ? 'PUT' : 'POST';
    const url = postId ? `${API_BASE}/create-post/${postId}` : `${API_BASE}/create-post`;

    const response = await apiFetch(url, {
        method,
        body: JSON.stringify(postData),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Unable to save post');
    }
    return data;
}

export async function deletePost(postId) {
    const response = await apiFetch(`${API_BASE}/create-post/${postId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to delete post');
    }
}

export async function unschedulePost(postId) {
    const response = await apiFetch(`${API_BASE}/schedule-post/${postId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to cancel scheduled post');
    }
}

export async function schedulePost(postId, scheduledTime) {
    const response = await apiFetch(`${API_BASE}/schedule-post`, {
        method: 'POST',
        body: JSON.stringify({ postId, scheduledTime }),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Schedule failed');
    }
    return data;
}

export async function publishPostNow(postId) {
    const response = await apiFetch(`${API_BASE}/publish-post`, {
        method: 'POST',
        body: JSON.stringify({ postId }),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Publish failed');
    }
    return data;
}
