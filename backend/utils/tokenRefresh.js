const axios = require('axios');
const admin = require('firebase-admin');
const { info: logInfo, error: logError } = require('./logger');
const { decrypt, encrypt } = require('./encryption');
const db = admin.firestore();

/**
 * Refresh Facebook/Instagram token using long-lived access token
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
        const expiresIn = response.data.expires_in || 5184000;

        logInfo(`Refreshed Facebook token for account ${accountId}`);
        return {
            accessToken: newToken,
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
        const expiresIn = response.data.expires_in || 3600;

        logInfo(`Refreshed YouTube token for account ${accountId}`);
        return {
            accessToken: newToken,
            tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        };
    } catch (err) {
        logError(`Failed to refresh YouTube token for ${accountId}: ${err.message}`);
        return null;
    }
}

/**
 * Check and refresh token if expired
 */
async function ensureValidToken(accountDoc, account) {
    const now = Date.now();
    const tokenExpiresAt = account.tokenExpiresAt?.toMillis?.() || account.tokenExpiresAt || null;

    // Decrypt current tokens
    const currentAccessToken = decrypt(account.accessToken);
    const currentRefreshToken = decrypt(account.refreshToken);

    // Token still valid? (with 5 minute buffer)
    if (tokenExpiresAt && tokenExpiresAt > now + 300000) {
        return currentAccessToken;
    }

    logInfo(`Token expired for ${account.platform} account ${account.accountId}. Attempting refresh...`);

    let refreshed = null;
    if (account.platform === 'youtube' && currentRefreshToken) {
        refreshed = await refreshYouTubeToken(accountDoc.id, currentRefreshToken);
    } else if (['facebook', 'instagram'].includes(account.platform)) {
        refreshed = await refreshFacebookToken(accountDoc.id, currentAccessToken);
    }

    if (refreshed) {
        await db.collection('platformAccounts').doc(accountDoc.id).set({
            accessToken: encrypt(refreshed.accessToken),
            tokenExpiresAt: refreshed.tokenExpiresAt,
            lastRefreshedAt: new Date(),
        }, { merge: true });
        return refreshed.accessToken;
    }

    return null;
}

async function getValidToken(accountId) {
    try {
        const accountDoc = await db.collection('platformAccounts').doc(accountId).get();
        if (!accountDoc.exists) throw new Error('Account not found');

        const account = accountDoc.data();
        const token = await ensureValidToken(accountDoc, account);

        if (!token) throw new Error(`Token expired and could not be refreshed for ${account.platform}`);

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
