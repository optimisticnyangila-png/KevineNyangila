/**
 * FlowPost Auth Module
 * Handles authentication and session management
 */

import { apiFetch, API_BASE } from './api.js';
import { showLogin, showRegister } from './ui.js';

export async function isSessionValid() {
    try {
        const r = await apiFetch(`${API_BASE}/auth/verify`);
        if (r.ok) {
            const data = await r.json();
            if (data.success && data.token) {
                localStorage.setItem('token', data.token);
            }
            return true;
        }
    } catch (e) {
        console.error('Session validation error', e);
    }
    return false;
}

export async function login(email, password) {
    if (!email || !password) {
        throw new Error('Please enter both email and password.');
    }
    localStorage.removeItem('token');
    const response = await apiFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (response.ok && data.success) {
        if (data.token) {
            localStorage.setItem('token', data.token);
        }
        return data;
    } else {
        throw new Error(data.error || 'Login failed');
    }
}

export async function signup(email, password) {
    if (!email || !password) {
        throw new Error('Please enter both email and password.');
    }
    localStorage.removeItem('token');
    const response = await apiFetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (response.ok && data.success) {
        if (data.token) {
            localStorage.setItem('token', data.token);
        }
        return data;
    } else {
        throw new Error(data.error || 'Registration failed');
    }
}

export async function logout() {
    try {
        await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
    } catch (_) {
        /* ignore */
    }
    localStorage.removeItem('token');
    showLogin();
}

export function handleGoogleLogin() {
    window.location.href = `${API_BASE}/auth/google`;
}

export function handleFacebookLogin() {
    window.location.href = `${API_BASE}/auth/facebook`;
}
