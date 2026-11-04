/**
 * FlowPost UI Module
 * Handles DOM manipulations and UI state
 */

import { apiFetch, API_BASE } from './api.js';

export function showLogin() {
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

export function showRegister() {
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
}

export function displayCommandOutput(message, isError = false) {
    const output = document.getElementById('command-output');
    if (!output) return;
    output.textContent = message;
    output.classList.toggle('error', isError);
    output.classList.remove('hidden');
}

export function clearCommandOutput() {
    const output = document.getElementById('command-output');
    if (!output) return;
    output.textContent = '';
    output.classList.add('hidden');
}

export function renderAccountCheckboxes(accounts, grouped) {
    const container = document.getElementById('account-selection-container');
    if (!container) return;

    container.innerHTML = '';
    if (accounts.length === 0) {
        container.innerHTML = '<p class="empty-state">No connected accounts. Connect a platform to get started.</p>';
        return;
    }

    const platforms = ['facebook', 'instagram', 'youtube', 'tiktok'];
    platforms.forEach(platform => {
        const platformAccounts = grouped[platform] || [];
        if (platformAccounts.length === 0) return;

        const section = document.createElement('div');
        section.className = 'account-platform-group';

        const header = document.createElement('h4');
        header.textContent = `${platform.toUpperCase()} (${platformAccounts.length})`;
        section.appendChild(header);

        platformAccounts.forEach(account => {
            const label = document.createElement('label');
            label.className = 'account-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = account.id;
            checkbox.className = 'account-checkbox';
            checkbox.dataset.platform = account.platform;
            checkbox.dataset.accountName = account.accountName;

            const accountText = document.createElement('span');
            accountText.textContent = account.accountName;

            const cleanStatusBadge = document.createElement('span');
            cleanStatusBadge.className = account.status === 'expired' ? 'status-expired' : 'status-active';
            cleanStatusBadge.textContent = account.status === 'expired' ? 'Expired' : 'Active';

            label.appendChild(checkbox);
            label.appendChild(accountText);
            label.appendChild(cleanStatusBadge);
            section.appendChild(label);
        });

        container.appendChild(section);
    });
}

export function updatePlatformSummary(accounts) {
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
        li.textContent = `${label}: ${count} account${count !== 1 ? 's' : ''} connected`;
        statusEl.appendChild(li);
    });
}

export function showPublishResults(postId, results, retryCallback) {
    const resultsDiv = document.getElementById('publish-results');
    const resultsList = document.getElementById('publish-results-list');
    if (!resultsDiv || !resultsList) return;

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

            if (!result.requiresReauth && retryCallback) {
                const retryBtn = document.createElement('button');
                retryBtn.textContent = 'Retry';
                retryBtn.style.marginLeft = '10px';
                retryBtn.addEventListener('click', () => retryCallback(postId, [accountId]));
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

export function getSelectedAccounts() {
    const checkboxes = document.querySelectorAll('.account-checkbox:checked');
    return Array.from(checkboxes).map(cb => ({
        id: cb.value,
        platform: cb.dataset.platform,
        accountName: cb.dataset.accountName
    }));
}
