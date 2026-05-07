const axios = require('axios');
const admin = require('firebase-admin');
const { info: logInfo, error: logError } = require('./logger');
const db = admin.firestore();

/**
 * Refresh Facebook/Instagram token using long-lived access token
 * Facebook tokens last ~60 days; this extends them to 60 more days
 */
async function refreshFacebookToken(accountId, oldToken) {
    try {
        if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
            throw new Error('Facebook credentials not configured');
        }

        const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: process.env.FACEBOOK_APP_ID,
                client_secret: process.env.FACEBOOK_APP_SECRET,
                fb_exchange_token: oldToken,
            },
        });

        const newToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 5184000; // 60 days in seconds

        logInfo(`Refreshed Facebook token for account ${accountId}`);
        return {
            accessToken: newToken,
            expiresIn,
            tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        };
    } catch (err) {
        logError(`Failed to refresh Facebook token for ${accountId}: ${err.message}`);
        return null;
    }
}

/**
 * Refresh YouTube token using refresh token
 */
async function refreshYouTubeToken(accountId, refreshToken) {
    try {
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
            throw new Error('YouTube OAuth credentials not configured');
        }

        const response = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        });

        const newToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600; // 1 hour in seconds

        logInfo(`Refreshed YouTube token for account ${accountId}`);
        return {
            accessToken: newToken,
            expiresIn,
            tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        };
    } catch (err) {
        logError(`Failed to refresh YouTube token for ${accountId}: ${err.message}`);
        return null;
    }
}

/**
 * Check and refresh token if expired
 * Returns updated token or null if refresh failed
 */
async function ensureValidToken(accountDoc, account) {
    const now = Date.now();
    const tokenExpiresAt = account.tokenExpiresAt ?.toMillis ?.() || account.tokenExpiresAt || null;

    // Token still valid? (with 5 minute buffer)
    if (tokenExpiresAt && tokenExpiresAt > now + 300000) {
        return account.accessToken;
    }

    logInfo(`Token expired for ${account.platform} account ${account.accountId}. Attempting refresh...`);

    let refreshed = null;
    if (account.platform === 'youtube' && account.refreshToken) {
        refreshed = await refreshYouTubeToken(accountDoc.id, account.refreshToken);
    } else if (['facebook', 'instagram'].includes(account.platform)) {
        refreshed = await refreshFacebookToken(accountDoc.id, account.accessToken);
    } else {
        logError(`Cannot refresh ${account.platform} token: no refresh mechanism`);
        return null;
    }

    if (refreshed) {
        // Update database
        await db.collection('platformAccounts').doc(accountDoc.id).set({
            accessToken: refreshed.accessToken,
            tokenExpiresAt: refreshed.tokenExpiresAt,
            lastRefreshedAt: new Date(),
        }, { merge: true });
        return refreshed.accessToken;
    }

    return null;
}

/**
 * Get valid token for an account, refreshing if necessary
 */
async function getValidToken(accountId) {
    try {
        const accountDoc = await db.collection('platformAccounts').doc(accountId).get();
        if (!accountDoc.exists) {
            throw new Error('Account not found');
        }

        const account = accountDoc.data();
        const token = await ensureValidToken(accountDoc, account);

        if (!token) {
            throw new Error(`Token expired and could not be refreshed for ${account.platform}`);
        }

        return token;
    } catch (err) {
        logError(`getValidToken failed for ${accountId}: ${err.message}`);
        throw err;
    }
}

module.exports = {
    refreshFacebookToken,
    refreshYouTubeToken,
    ensureValidToken,
    getValidToken,
};
