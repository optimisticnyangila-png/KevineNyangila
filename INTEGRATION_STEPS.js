/**
 * FLOWPOST FRONTEND INTEGRATION GUIDE
 * Step-by-step guide to wire up account selection
 * 
 * BEFORE YOU START:
 * - Backend is ready ✓
 * - Account selection functions exist ✓
 * - You just need to integrate them
 */

// ============================================
// STEP 1: REPLACE loadPlatformStatus() IN app.js
// ============================================
// 
// Find this line in your app.js:
//   await loadPlatformStatus();
//
// Replace the entire loadPlatformStatus() function with this:

async function loadPlatformAccounts() {
    try {
        const response = await apiFetch(`${API_BASE}/platforms/platform-accounts`);
        const data = await response.json();
        if (!response.ok) {
            console.warn('Unable to load platform accounts:', data.error);
            return;
        }

        // Group accounts by platform for display
        renderAccountCheckboxes(data.accounts || [], data.grouped || {});
        updatePlatformSummary(data.accounts || []);
    } catch (error) {
        console.error('Error loading platform accounts:', error);
    }
}

// ============================================
// STEP 2: ADD renderAccountCheckboxes() function
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
// STEP 3: ADD updatePlatformSummary() function
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
// STEP 4: ADD getSelectedAccounts() function
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
// STEP 5: UPDATE showDashboard()
// ============================================
// Find this in app.js:
//   async function showDashboard() {
//       ...
//       await loadPlatformStatus();  // <- CHANGE THIS LINE
//
// Replace with:

async function showDashboard() {
    document.getElementById('login').classList.add('hidden');
    document.getElementById('register').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    // CHANGE: loadPlatformStatus() → loadPlatformAccounts()
    await loadPlatformAccounts();

    await loadDraftPosts();
    await loadScheduledPosts();
    await refreshActivePostSelect();
}

// ============================================
// STEP 6: REPLACE create post button handler
// ============================================
// Find this event listener in app.js:
//   document.getElementById('create-post-btn').addEventListener('click', async() => {
//
// Replace the entire handler with this:

document.getElementById('create-post-btn').addEventListener('click', async() => {
    const content = document.getElementById('post-content').value;
    const media = document.getElementById('media-upload').files;

    // NEW: Get selected accounts instead of platforms
    const accountCheckboxes = document.querySelectorAll('.account-checkbox:checked');
    if (accountCheckboxes.length === 0) {
        alert('❌ Please select at least one account to publish to.');
        return;
    }

    const selectedAccountIds = Array.from(accountCheckboxes).map(cb => cb.value);
    const selectedPlatforms = [...new Set(
        Array.from(accountCheckboxes).map(cb => cb.dataset.platform)
    )];

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
                targets: selectedAccountIds, // NEW: Send account IDs
                platforms: selectedPlatforms // Keep for backward compat
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
    } catch (error) {
        alert(error.message);
    }
});

// ============================================
// STEP 7: UPDATE publish handler
// ============================================
// Find the publish button handler (likely calls publishPost() or similar)
// Replace with this to show per-account results:

async function publishPost(postId) {
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

        // NEW: Show per-account results
        const results = data.result || {};
        let summary = '📊 Publish Results:\n\n';
        let failedAccounts = [];

        Object.entries(results).forEach(([accountId, result]) => {
            if (result.success) {
                summary += `✓ ${result.accountName} (${result.platform})\n`;
            } else {
                summary += `✗ ${result.accountName || accountId}: ${result.error}\n`;
                if (result.requiresReauth) {
                    failedAccounts.push({ accountId, accountName: result.accountName });
                }
            }
        });

        alert(summary);

        // Offer to reconnect if token expired
        if (failedAccounts.length > 0) {
            const shouldReconnect = confirm(
                `${failedAccounts.length} account(s) need re-authentication.\n\n` +
                `Failed: ${failedAccounts.map(a => a.accountName).join(', ')}\n\n` +
                `Reconnect now?`
            );
            if (shouldReconnect) {
                alert('Redirecting to reconnect page...');
                // User can manually click reconnect buttons
            }
        }

        await loadScheduledPosts();
    } catch (error) {
        alert(error.message);
    }
}

// ============================================
// STEP 8: ADD disconnect account function (optional but nice to have)
// ============================================

async function disconnectAccount(accountId, accountName) {
    const confirmed = confirm(`Disconnect "${accountName}"?`);
    if (!confirmed) return;

    try {
        const response = await apiFetch(
            `${API_BASE}/platforms/platform-accounts/${accountId}`, { method: 'DELETE' }
        );

        if (!response.ok) {
            const data = await response.json();
            alert(data.error || 'Failed to disconnect');
            return;
        }

        alert(`✓ "${accountName}" disconnected.`);
        await loadPlatformAccounts();
    } catch (error) {
        alert(error.message);
    }
}

// ============================================
// STEP 9: HTML CHANGES NEEDED
// ============================================
// In index.html, find the create-post section and:
//
// 1. REPLACE this:
//    <select id="platforms" multiple>
//        <option value="facebook">Facebook</option>
//        ...
//    </select>
//
// WITH this:
//    <div id="account-selection-container" class="account-section-wrapper">
//        <!-- Will be populated dynamically -->
//    </div>
//
// 2. ADD this CSS to style.css:

const CSS_TO_ADD = `
.account-section-wrapper {
    margin: 15px 0;
    padding: 10px;
    background-color: #f9f9f9;
    border-radius: 4px;
    border: 1px solid #ddd;
}

.account-section {
    margin-bottom: 15px;
    padding: 12px;
    background-color: #f5f5f5;
    border-left: 4px solid #2196F3;
    border-radius: 4px;
}

.account-section h4 {
    margin: 0 0 10px 0;
    color: #333;
    font-size: 0.95em;
    font-weight: 600;
}

.account-section label {
    display: block;
    margin-bottom: 8px;
    cursor: pointer;
    padding: 6px;
    border-radius: 3px;
    transition: background-color 0.2s;
}

.account-section label:hover {
    background-color: #efefef;
}

.account-section input[type="checkbox"] {
    cursor: pointer;
    margin-right: 8px;
}
`;

export {
    loadPlatformAccounts,
    renderAccountCheckboxes,
    updatePlatformSummary,
    getSelectedAccounts,
    publishPost,
    disconnectAccount
};