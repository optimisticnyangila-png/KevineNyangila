const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const { COOKIE_NAME } = require('../utils/authCookie');

const router = express.Router();

const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

function jwtSecret() {
    return process.env.JWT_SECRET;
}

const GOOGLE_YOUTUBE_REDIRECT_URI =
    process.env.GOOGLE_YOUTUBE_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/google/callback`;

const FB_REDIRECT_URI =
    process.env.FACEBOOK_CONNECT_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/facebook/callback`;
const IG_REDIRECT_URI =
    process.env.IG_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/instagram/callback`;
const TIKTOK_REDIRECT_URI =
    process.env.TIKTOK_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/tiktok/callback`;

async function savePlatformData(uid, platform, data) {
    await admin.firestore().collection('users').doc(uid).set({
        [platform]: {...data, updatedAt: new Date() },
    }, { merge: true });
}

async function savePlatformAccount(uid, platform, accountId, accountName, accessToken, refreshToken = null) {
    await admin.firestore().collection('platformAccounts').add({
        uid,
        platform,
        accountId,
        accountName,
        accessToken,
        refreshToken,
        createdAt: new Date()
    });
}

function getSessionUid(req, res) {
    const secret = jwtSecret();
    if (!secret) {
        res.status(500).send('Server misconfiguration');
        return null;
    }
    const raw = req.cookies && req.cookies[COOKIE_NAME];
    if (!raw) {
        res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('login_required')}`);
        return null;
    }
    try {
        const d = jwt.verify(raw, secret);
        return d.uid;
    } catch {
        res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('invalid_session')}`);
        return null;
    }
}

function signPlatformState(platform, uid) {
    const secret = jwtSecret();
    return jwt.sign({ t: 'platform', platform, uid, n: crypto.randomBytes(8).toString('hex') }, secret, { expiresIn: '10m' });
}

function verifyPlatformState(state, expectedPlatform) {
    const secret = jwtSecret();
    const decoded = jwt.verify(state, secret);
    if (decoded.t !== 'platform' || decoded.platform !== expectedPlatform || !decoded.uid) {
        throw new Error('Invalid state');
    }
    return decoded;
}

async function fetchFacebookPages(accessToken) {
    const response = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: {
            access_token: accessToken,
            fields: 'id,name,access_token,instagram_business_account{username,id}',
        },
    });
    return response.data.data || [];
}

async function fetchInstagramAccounts(accessToken) {
    const response = await axios.get('https://graph.facebook.com/v16.0/me/accounts', {
        params: {
            access_token: accessToken,
            fields: 'id,name,access_token,instagram_business_account{username,id}',
        },
    });

    const pages = response.data.data || [];
    return pages
        .filter((page) => page.instagram_business_account)
        .map((page) => ({
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username || null,
            pageId: page.id,
            pageAccessToken: page.access_token,
            name: page.name,
        }));
}

async function fetchTikTokAccount(accessToken, openId) {
    const response = await axios.get('https://open-api.tiktok.com/user/info/', {
        params: {
            open_id: openId,
            access_token: accessToken,
        },
    });
    const data = response.data.data || {};
    return {
        open_id: openId,
        nickname: data.nickname || data.display_name || null,
        avatar: data.avatar_url || null,
    };
}

// --- YouTube ---
router.get('/youtube/authorize', (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(500).send('GOOGLE_CLIENT_ID not configured');
    }

    const state = signPlatformState('youtube', uid);
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_YOUTUBE_REDIRECT_URI,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload',
        state,
        access_type: 'offline',
        prompt: 'consent',
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
        const msg = errorDescription || error;
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(msg))}`);
    }

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'youtube');
    } catch {
        return res.status(400).send('Invalid OAuth state');
    }

    if (!code) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=missing_code`);
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(500).send('GOOGLE_CLIENT_SECRET not configured');
    }

    try {
        const response = await axios.post(
            process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_YOUTUBE_REDIRECT_URI,
                grant_type: 'authorization_code',
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const tokens = {
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_in: response.data.expires_in,
            obtainedAt: new Date().toISOString(),
            expiresAt: response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000).toISOString() : null,
        };

        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
        });

        let channels = [];
        try {
            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
            const channelResponse = await youtube.channels.list({ part: 'snippet', mine: true });
            channels = (channelResponse.data.items || []).map((item) => ({ id: item.id, title: item.snippet.title }));
        } catch (channelErr) {
            console.warn('Unable to fetch YouTube channels', channelErr.message || channelErr);
        }

        // Save each YouTube channel
        for (const channel of channels) {
            await savePlatformAccount(decodedState.uid, 'youtube', channel.id, channel.title, tokens.access_token, tokens.refresh_token);
        }

        await savePlatformData(decodedState.uid, 'youtube', {
            ...tokens,
            channels,
            selectedChannelId: channels[0] ?.id || null,
        });

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?youtube=connected`);
    } catch (err) {
        console.error(err.response ?.data || err.message);
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=youtube_oauth_failed`);
    }
});

// --- Facebook ---
router.get('/facebook/authorize', (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
    if (!process.env.FB_APP_ID) {
        return res.status(500).send('FB_APP_ID not configured');
    }

    const state = signPlatformState('facebook', uid);
    const scope = process.env.FB_SCOPE || 'pages_manage_posts,pages_read_engagement';
    const params = new URLSearchParams({
        client_id: process.env.FB_APP_ID,
        redirect_uri: FB_REDIRECT_URI,
        response_type: 'code',
        scope,
        state,
    });

    res.redirect(`https://www.facebook.com/v16.0/dialog/oauth?${params.toString()}`);
});

router.get('/facebook/callback', async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
        const msg = errorDescription || error;
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(msg))}`);
    }

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'facebook');
    } catch {
        return res.status(400).send('Invalid OAuth state');
    }

    if (!code) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=missing_code`);
    }

    if (!process.env.FB_APP_SECRET) {
        return res.status(500).send('FB_APP_SECRET not configured');
    }

    try {
        const response = await axios.get('https://graph.facebook.com/v16.0/oauth/access_token', {
            params: {
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                redirect_uri: FB_REDIRECT_URI,
                code,
            },
        });

        const tokens = {
            access_token: response.data.access_token,
            token_type: response.data.token_type,
            expires_in: response.data.expires_in,
            obtainedAt: new Date().toISOString(),
            expiresAt: response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000).toISOString() : null,
        };

        let pages = [];
        try {
            pages = await fetchFacebookPages(tokens.access_token);
        } catch (pagesErr) {
            console.warn('Unable to fetch Facebook pages', pagesErr.message || pagesErr);
        }

        // Save each page as a separate account
        for (const page of pages) {
            await savePlatformAccount(decodedState.uid, 'facebook', page.id, page.name, page.access_token);
        }

        await savePlatformData(decodedState.uid, 'facebook', {
            ...tokens,
            pages,
            selectedPageId: pages[0] ?.id || null,
        });

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?facebook=connected`);
    } catch (err) {
        console.error(err.response ?.data || err.message);
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=facebook_oauth_failed`);
    }
});

// --- Instagram ---
router.get('/instagram/authorize', (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
    if (!process.env.IG_APP_ID) {
        return res.status(500).send('IG_APP_ID not configured');
    }

    const state = signPlatformState('instagram', uid);
    const scope = process.env.IG_SCOPE || 'user_profile,user_media';
    const params = new URLSearchParams({
        client_id: process.env.IG_APP_ID,
        redirect_uri: IG_REDIRECT_URI,
        response_type: 'code',
        scope,
        state,
    });

    res.redirect(`https://api.instagram.com/oauth/authorize?${params.toString()}`);
});

router.get('/instagram/callback', async(req, res) => {
    const { code, state, error, error_reason: errorReason, error_description: errorDescription } = req.query;
    if (error) {
        const msg = errorDescription || errorReason || error;
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(msg))}`);
    }

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'instagram');
    } catch {
        return res.status(400).send('Invalid OAuth state');
    }

    if (!code) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=missing_code`);
    }

    if (!process.env.IG_APP_SECRET) {
        return res.status(500).send('IG_APP_SECRET not configured');
    }

    try {
        const response = await axios.get('https://graph.facebook.com/v16.0/oauth/access_token', {
            params: {
                client_id: process.env.IG_APP_ID,
                client_secret: process.env.IG_APP_SECRET,
                redirect_uri: IG_REDIRECT_URI,
                code,
                grant_type: 'authorization_code',
            },
        });

        const tokens = {
            access_token: response.data.access_token,
            token_type: response.data.token_type,
            expires_in: response.data.expires_in,
            obtainedAt: new Date().toISOString(),
            expiresAt: response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000).toISOString() : null,
        };

        let accounts = [];
        try {
            accounts = await fetchInstagramAccounts(tokens.access_token);
        } catch (accountsErr) {
            console.warn('Unable to fetch Instagram accounts', accountsErr.message || accountsErr);
        }

        // Save each Instagram account
        for (const account of accounts) {
            await savePlatformAccount(decodedState.uid, 'instagram', account.id, account.username || account.name, tokens.access_token);
        }

        await savePlatformData(decodedState.uid, 'instagram', {
            ...tokens,
            accounts,
            selectedAccountId: accounts[0] ?.id || null,
        });

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?instagram=connected`);
    } catch (err) {
        console.error(err.response ?.data || err.message);
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=instagram_oauth_failed`);
    }
});

// --- TikTok ---
router.get('/tiktok/authorize', (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
    if (!process.env.TIKTOK_CLIENT_KEY) {
        return res.status(500).send('TIKTOK_CLIENT_KEY not configured');
    }

    const state = signPlatformState('tiktok', uid);
    const scope = process.env.TIKTOK_SCOPE || 'user.info.basic,video.publish';
    const params = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        redirect_uri: TIKTOK_REDIRECT_URI,
        response_type: 'code',
        scope,
        state,
    });

    res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
});

router.get('/tiktok/callback', async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) {
        const msg = errorDescription || error;
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(msg))}`);
    }

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'tiktok');
    } catch {
        return res.status(400).send('Invalid OAuth state');
    }

    if (!code) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=missing_code`);
    }

    if (!process.env.TIKTOK_CLIENT_SECRET) {
        return res.status(500).send('TIKTOK_CLIENT_SECRET not configured');
    }

    try {
        const body = new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY,
            client_secret: process.env.TIKTOK_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: TIKTOK_REDIRECT_URI,
        });

        const response = await axios.post('https://open-api.tiktok.com/oauth/access_token/', body, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const d = response.data.data || response.data;
        const tokens = {
            access_token: d.access_token,
            refresh_token: d.refresh_token,
            open_id: d.open_id,
            expires_in: d.expires_in,
            obtainedAt: new Date().toISOString(),
            expiresAt: d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null,
        };

        let account = null;
        try {
            account = await fetchTikTokAccount(tokens.access_token, tokens.open_id);
        } catch (accountErr) {
            console.warn('Unable to fetch TikTok account info', accountErr.message || accountErr);
        }

        // Save TikTok account
        if (account) {
            await savePlatformAccount(decodedState.uid, 'tiktok', tokens.open_id, account.nickname || 'TikTok Account', tokens.access_token);
        }

        await savePlatformData(decodedState.uid, 'tiktok', {
            ...tokens,
            account,
        });

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?tiktok=connected`);
    } catch (err) {
        console.error(err.response ?.data || err.message);
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=tiktok_oauth_failed`);
    }
});

module.exports = router;
