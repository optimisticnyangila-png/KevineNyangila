const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const { COOKIE_NAME } = require('../utils/authCookie');
const { encrypt } = require('../utils/encryption');

const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

function jwtSecret() {
    return process.env.JWT_SECRET;
}

const GOOGLE_YOUTUBE_REDIRECT_URI = process.env.GOOGLE_YOUTUBE_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/google/callback`;
const FB_REDIRECT_URI = process.env.FACEBOOK_CONNECT_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/facebook/callback`;
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/instagram/callback`;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${BACKEND_ORIGIN}/connect-platform/tiktok/callback`;

async function savePlatformAccount(uid, platform, accountId, accountName, accessToken, refreshToken = null) {
    await admin.firestore().collection('platformAccounts').add({
        uid,
        platform,
        accountId,
        accountName,
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : null,
        createdAt: new Date(),
        updatedAt: new Date()
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

exports.authorizeYouTube = (req, res) => {
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
};

exports.youtubeCallback = async(req, res) => {
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

    if (!code) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=missing_code`);

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
            obtainedAt: new Date().toISOString(),
        };

        const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });

        let channels = [];
        try {
            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
            const channelResponse = await youtube.channels.list({ part: 'snippet', mine: true });
            channels = (channelResponse.data.items || []).map((item) => ({ id: item.id, title: item.snippet.title }));
        } catch (channelErr) {
            console.warn('Unable to fetch YouTube channels', channelErr.message);
        }

        for (const channel of channels) {
            await savePlatformAccount(decodedState.uid, 'youtube', channel.id, channel.title, tokens.access_token, tokens.refresh_token);
        }

        res.redirect(`${FRONTEND_ORIGIN}/dashboard?youtube=connected`);
    } catch (err) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=youtube_oauth_failed`);
    }
};

// --- Facebook ---

exports.authorizeFacebook = (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
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
};

exports.facebookCallback = async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(errorDescription || error))}`);

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'facebook');
    } catch {
        return res.status(400).send('Invalid OAuth state');
    }

    try {
        const response = await axios.get('https://graph.facebook.com/v16.0/oauth/access_token', {
            params: { client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, redirect_uri: FB_REDIRECT_URI, code },
        });

        const accessToken = response.data.access_token;
        const pages = await fetchFacebookPages(accessToken);

        for (const page of pages) {
            await savePlatformAccount(decodedState.uid, 'facebook', page.id, page.name, page.access_token);
        }

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?facebook=connected`);
    } catch (err) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=facebook_oauth_failed`);
    }
};

// --- Instagram ---

exports.authorizeInstagram = (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
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
};

exports.instagramCallback = async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(errorDescription || error))}`);

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'instagram');
    } catch {
        return res.status(400).send('Invalid OAuth state');
    }

    try {
        const response = await axios.get('https://graph.facebook.com/v16.0/oauth/access_token', {
            params: { client_id: process.env.IG_APP_ID, client_secret: process.env.IG_APP_SECRET, redirect_uri: IG_REDIRECT_URI, code, grant_type: 'authorization_code' },
        });

        const accessToken = response.data.access_token;
        const accounts = await fetchInstagramAccounts(accessToken);

        for (const account of accounts) {
            await savePlatformAccount(decodedState.uid, 'instagram', account.id, account.username || account.name, accessToken);
        }

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?instagram=connected`);
    } catch (err) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=instagram_oauth_failed`);
    }
};

// --- TikTok ---

exports.authorizeTikTok = (req, res) => {
    const uid = getSessionUid(req, res);
    if (uid == null) return;
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
};

exports.tiktokCallback = async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(errorDescription || error))}`);

    let decodedState;
    try {
        decodedState = verifyPlatformState(state, 'tiktok');
    } catch {
        return res.status(400).send('Invalid OAuth state');
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
        const accessToken = d.access_token;
        const openId = d.open_id;

        const account = await fetchTikTokAccount(accessToken, openId);
        if (account) {
            await savePlatformAccount(decodedState.uid, 'tiktok', openId, account.nickname || 'TikTok Account', accessToken, d.refresh_token);
        }

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?tiktok=connected`);
    } catch (err) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=tiktok_oauth_failed`);
    }
};
