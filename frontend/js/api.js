/**
 * FlowPost API Module
 * Handles communication with the backend
 */

const runtimeConfig = window.__FLOWPOST_CONFIG__ || {};
const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
);
const DEFAULT_API_BASE = isLocalhost ? 'http://localhost:5000' : 'https://flowpost-backed.onrender.com';
const apiBaseMeta = document.querySelector('meta[name="api-base"]')?.content;

export const API_BASE = (
    runtimeConfig.API_BASE ||
    (isLocalhost ? 'http://localhost:5000' : null) ||
    apiBaseMeta ||
    DEFAULT_API_BASE
).replace(/\/$/, '');

/** All API calls send the Firebase ID token if available, plus credentials for cookies. */
export function apiFetch(url, options = {}) {
    const { headers: hdr, ...rest } = options;
    const headers = { ...hdr };
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
