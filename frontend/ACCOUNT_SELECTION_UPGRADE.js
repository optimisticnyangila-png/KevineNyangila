/**
 * FLOWPOST FRONTEND - MULTI-ACCOUNT UPGRADE GUIDE
 * This file documents the key changes needed to upgrade the frontend
 * from platform-based selection to account-based selection
 */

// ============================================
// 1. LOAD PLATFORM ACCOUNTS (instead of platform status)
// ============================================
async function loadPlatformAccounts() {
    try {
        const response = await apiFetch(`${API_BASE}/platforms/platform-accounts`);
        const data = await response.json();
        if (!response.ok) {
            console.warn('Unable to load platform accounts:', data.error);
            return;
        }

        // Group accounts by platform for display
        const grouped = data.grouped || {};
        renderAccountCheckboxes(data.accounts || [], grouped);
        updatePlatformSummary(data.accounts || []);
    } catch (error) {
        console.error('Error loading platform accounts:', error);
    }
}

// ============================================
// 2. RENDER ACCOUNT CHECKBOXES (replace platform dropdown)
// ============================================
function renderAccountCheckboxes(accounts, grouped) {
    const container = document.getElementById('account-selection-container');
    if (!container) {
        console.warn('account-selection-container not found in HTML');
        return;
    }

    container.innerHTML = '';

    if (accounts.length === 0) {
        container.innerHTML = '<p style="color: #999;">No connected accounts. Connect a platform to get started.</p>';
        return;
    }

    // Create platform sections
    const platforms = ['facebook', 'instagram', 'youtube', 'tiktok'];
    platforms.forEach(platform => {
        const platformAccounts = grouped[platform] || [];
        if (platformAccounts.length === 0) return;

        // Platform header
        const section = document.createElement('div');
        section.className = 'account-section';
        section.style.marginBottom = '15px';
        section.style.padding = '10px';
        section.style.backgroundColor = '#f5f5f5';
        section.style.borderRadius = '4px';

        const header = document.createElement('h4');
        header.textContent = `${platform.toUpperCase()} (${platformAccounts.length})`;
        header.style.margin = '0 0 10px 0';
        section.appendChild(header);

        // Account checkboxes
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

            const statusBadge = account.status === 'expired' ?
                ' ⚠️ Token Expired' :
                ' ✓ Active';

            label.innerHTML = `
                ${checkbox.outerHTML}
                <span style="margin-left: 8px; font-weight: 500;">
                    ${account.accountName} 
                    <span style="color: ${account.status === 'expired' ? '#d32f2f' : '#4caf50'}; font-size: 0.9em;">
                        ${statusBadge}
                    </span>
                </span>
            `;

            section.appendChild(label);
        });

        container.appendChild(section);
    });
}

// ============================================
// 3. UPDATE PLATFORM SUMMARY (show connection counts)
// ============================================
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

// ============================================
// 4. GET SELECTED ACCOUNTS (instead of platforms)
// ============================================
function getSelectedAccounts() {
    const checkboxes = document.querySelectorAll('.account-checkbox:checked');
    return Array.from(checkboxes).map(cb => ({
        id: cb.value,
        platform: cb.dataset.platform,
        accountName: cb.dataset.accountName
    }));
}

// ============================================
// 5. VALIDATE ACCOUNT SELECTION
// ============================================
function validateAccountSelection() {
    const selected = getSelectedAccounts();
    if (selected.length === 0) {
        alert('Please select at least one account to publish to.');
        return false;
    }
    return true;
}

// ============================================
// 6. UPDATE CREATE POST HANDLER
// ============================================
async function createPostWithAccounts() {
    const content = document.getElementById('post-content').value;
    const media = document.getElementById('media-upload').files;

    // NEW: Get accounts instead of platforms
    const accounts = getSelectedAccounts();
    if (!validateAccountSelection()) return;

    const method = editingPostId ? 'PUT' : 'POST';
    const url = editingPostId ?
        `${API_BASE}/create-post/${editingPostId}` :
        `${API_BASE}/create-post`;

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
                // NEW: Use account IDs instead of platform names
                targets: accounts.map(a => a.id),
                // KEEP for backward compatibility
                platforms: [...new Set(accounts.map(a => a.platform))]
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.error || 'Unable to save post');
            return;
        }

        if (editingPostId) {
            alert('Post updated successfully.');
        } else {
            lastCreatedPostId = data.postId;
            alert('Post created: ' + data.postId);
        }

        clearEditingMode();
        document.getElementById('media-upload').value = '';
        document.getElementById('post-content').value = '';
        await loadDraftPosts();
    } catch (error) {
        alert(error.message);
    }
}

// ============================================
// 7. UPDATE PUBLISH HANDLER
// ============================================
async function publishPostWithResult(postId) {
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

        // NEW: Show detailed results per account
        const results = data.result || {};
        let summary = '';
        let failedAccounts = [];

        Object.entries(results).forEach(([accountId, result]) => {
            if (result.success) {
                summary += `✓ ${result.accountName} (${result.platform})\n`;
            } else {
                summary += `✗ ${result.accountName || accountId}: ${result.error}\n`;
                if (result.requiresReauth) {
                    failedAccounts.push({ accountId, reason: 'Token expired - needs re-authentication' });
                }
            }
        });

        alert(`Publish Results:\n\n${summary}`);

        // Optionally: offer retry for specific accounts
        if (failedAccounts.length > 0) {
            const retry = confirm(`${failedAccounts.length} account(s) need re-authentication. Reconnect now?`);
            if (retry) {
                // Redirect to reconnect page
                window.location.href = `${API_BASE}/connect-platform/reconnect`;
            }
        }

        await loadScheduledPosts();
    } catch (error) {
        alert(error.message);
    }
}

// ============================================
// 8. UPDATE DASHBOARD INIT
// ============================================
async function initializeDashboard() {
    // Replace loadPlatformStatus() with loadPlatformAccounts()
    await loadPlatformAccounts();
    await loadDraftPosts();
    await loadScheduledPosts();
}

// ============================================
// 9. DISCONNECT ACCOUNT UI
// ============================================
async function disconnectAccount(accountId, accountName) {
    const confirm_msg = confirm(`Disconnect "${accountName}"?`);
    if (!confirm_msg) return;

    try {
        const response = await apiFetch(`${API_BASE}/platforms/platform-accounts/${accountId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const data = await response.json();
            alert(data.error || 'Failed to disconnect');
            return;
        }

        alert(`"${accountName}" disconnected successfully.`);
        await loadPlatformAccounts();
    } catch (error) {
        alert(error.message);
    }
}

// ============================================
// 10. REFRESH TOKEN STATUS (optional UI feature)
// ============================================
async function refreshAccountTokenStatus() {
    await loadPlatformAccounts();
}

export {
    loadPlatformAccounts,
    renderAccountCheckboxes,
    updatePlatformSummary,
    getSelectedAccounts,
    validateAccountSelection,
    createPostWithAccounts,
    publishPostWithResult,
    initializeDashboard,
    disconnectAccount,
    refreshAccountTokenStatus
};