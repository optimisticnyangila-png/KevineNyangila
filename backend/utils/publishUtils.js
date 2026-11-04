const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { google } = require('googleapis');
const FormData = require('form-data');
const admin = require('firebase-admin');
const { getValidToken } = require('./tokenRefresh');
const { info: logInfo, error: logError } = require('./logger');
const { decrypt } = require('./encryption');

const db = admin.firestore();

function parseMediaType(url) {
    const lower = (url || '').split('?')[0].toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.m4v')) return 'video';
    return 'image';
}

async function downloadUrlToTempFile(url) {
    const tmp = path.join(os.tmpdir(), `flowpost-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const response = await axios.get(url, { responseType: 'stream', maxRedirects: 5, timeout: 120000 });
    await pipeline(response.data, fs.createWriteStream(tmp));
    return tmp;
}

async function publishToPlatforms(post) {
    const { uid, targets = [] } = post;
    const results = {};

    if (!targets.length) throw new Error('No target accounts specified');

    for (const target of targets) {
        try {
            const accountDoc = await db.collection("platformAccounts").doc(target).get();
            if (!accountDoc.exists) {
                results[target] = { success: false, error: "Account not found" };
                continue;
            }

            const rawAccount = accountDoc.data();
            if (rawAccount.uid !== uid) {
                results[target] = { success: false, error: "Unauthorized" };
                continue;
            }

            // Decrypt tokens for runtime use
            const account = {
                ...rawAccount,
                accessToken: decrypt(rawAccount.accessToken),
                refreshToken: decrypt(rawAccount.refreshToken)
            };

            const validToken = await getValidToken(target);
            account.accessToken = validToken;

            let result;
            switch (account.platform) {
                case "facebook": result = await publishToFacebook(post, account); break;
                case "youtube": result = await publishToYouTube(post, account); break;
                case "instagram": result = await publishToInstagram(post, account); break;
                case "tiktok": result = await publishToTikTok(post, account); break;
                default: throw new Error(`Unsupported platform: ${account.platform}`);
            }

            results[target] = { success: true, platform: account.platform, accountName: account.accountName, postId: result.id };
            logInfo(`Successfully published to ${account.platform}`);
        } catch (err) {
            results[target] = { success: false, error: err.message };
            logError(`Publish failed for ${target}: ${err.message}`);
        }
    }
    return results;
}

async function publishToFacebook(post, account) {
    const { content = '' } = post;
    const endpoint = account.accountId === 'me' ? 'me/feed' : `${account.accountId}/feed`;
    const response = await axios.post(`https://graph.facebook.com/v18.0/${endpoint}`, new URLSearchParams({
        message: content || 'Posted with FlowPost',
        access_token: account.accessToken,
    }).toString());
    return { id: response.data.id };
}

async function publishToInstagram(post, account) {
    const { content = '', mediaUrls = [] } = post;
    if (!mediaUrls.length) throw new Error('Instagram requires media');

    const primaryMediaUrl = mediaUrls[0];
    const mediaType = parseMediaType(primaryMediaUrl);
    const params = new URLSearchParams({ caption: content || '', access_token: account.accessToken });

    if (mediaType === 'video') params.append('video_url', primaryMediaUrl);
    else params.append('image_url', primaryMediaUrl);

    const createRes = await axios.post(`https://graph.facebook.com/v16.0/${account.accountId}/media`, params.toString());
    const publishRes = await axios.post(`https://graph.facebook.com/v16.0/${account.accountId}/media_publish`, new URLSearchParams({
        creation_id: createRes.data.id,
        access_token: account.accessToken
    }).toString());
    return { id: publishRes.data.id };
}

async function publishToYouTube(post, account) {
    const { content = '', mediaUrls = [] } = post;
    if (!mediaUrls.length) throw new Error('YouTube requires a video');

    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ access_token: account.accessToken, refresh_token: account.refreshToken });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const tmpPath = await downloadUrlToTempFile(mediaUrls[0]);
    try {
        const response = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: { snippet: { title: content.substring(0, 100), description: content }, status: { privacyStatus: 'private' } },
            media: { body: fs.createReadStream(tmpPath) },
        });
        return { id: response.data.id };
    } finally {
        fs.unlinkSync(tmpPath);
    }
}

async function publishToTikTok(post, account) {
    const { content = '', mediaUrls = [] } = post;
    if (!mediaUrls.length) throw new Error('TikTok requires a video');
    const tmpPath = await downloadUrlToTempFile(mediaUrls[0]);
    try {
        const form = new FormData();
        form.append('video', fs.createReadStream(tmpPath));
        const upRes = await axios.post(`https://open-api.tiktok.com/video/upload/?open_id=${account.accountId}&access_token=${account.accessToken}`, form, { headers: form.getHeaders() });
        const videoId = upRes.data?.data?.video_id;
        if (!videoId) throw new Error('TikTok upload failed');

        const pubRes = await axios.post(`https://open-api.tiktok.com/video/publish/?open_id=${account.accountId}&access_token=${account.accessToken}`, new URLSearchParams({
            video_id: videoId,
            text: content || 'FlowPost'
        }).toString());
        return { id: pubRes.data?.data?.video_id || videoId };
    } finally {
        fs.unlinkSync(tmpPath);
    }
}

module.exports = { publishToPlatforms };
