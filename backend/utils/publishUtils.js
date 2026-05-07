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

const db = admin.firestore();

function getAccessToken(platformTokens) {
    if (!platformTokens) return null;
    return platformTokens.access_token || platformTokens.accessToken || null;
}

function getRefreshToken(platformTokens) {
    if (!platformTokens) return null;
    return platformTokens.refresh_token || platformTokens.refreshToken || null;
}

function getPageAccessToken(pageMap, selectedId) {
    if (!Array.isArray(pageMap)) return null;
    if (selectedId) {
        const selected = pageMap.find((item) => item.id === selectedId);
        if (selected && selected.access_token) {
            return selected.access_token;
        }
    }
    const fallback = pageMap.find((item) => item.access_token);
    return fallback ?.access_token || null;
}

function getSelectedPlatformId(platformMap, selectedId) {
    if (!Array.isArray(platformMap)) return null;
    if (selectedId) {
        const selected = platformMap.find((item) => item.id === selectedId);
        return selected ?.id || null;
    }
    return platformMap[0] ?.id || null;
}

function parseMediaType(url) {
    const lower = (url || '').split('?')[0].toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.m4v')) return 'video';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.gif')) return 'image';
    return 'image';
}

async function downloadUrlToTempFile(url) {
    const tmp = path.join(os.tmpdir(), `flowpost-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const response = await axios.get(url, { responseType: 'stream', maxRedirects: 5, timeout: 120000 });
    await pipeline(response.data, fs.createWriteStream(tmp));
    return tmp;
}

async function publishToPlatforms(post) {
    const { uid, content = '', mediaUrls = [], targets = [] } = post;
    const results = {};

    if (!targets || targets.length === 0) {
        throw new Error('No target accounts specified');
    }

    logInfo(`Publishing to ${targets.length} account(s) for user ${uid}`);

    for (const target of targets) {
        try {
            const accountDoc = await db
                .collection("platformAccounts")
                .doc(target)
                .get();

            if (!accountDoc.exists) {
                results[target] = { success: false, error: "Account not found" };
                logError(`Account ${target} not found`);
                continue;
            }

            const account = accountDoc.data();

            // SECURITY CHECK: Verify user owns this account
            if (account.uid !== uid) {
                results[target] = { success: false, error: "Unauthorized account" };
                logError(`Unauthorized attempt to publish with account ${target}`);
                continue;
            }

            // Get valid token (refresh if needed)
            let validToken;
            try {
                validToken = await getValidToken(target);
            } catch (tokenErr) {
                results[target] = {
                    success: false,
                    error: `Token unavailable: ${tokenErr.message}`,
                    requiresReauth: true
                };
                logError(`Token issue for ${account.platform} account ${target}: ${tokenErr.message}`);
                continue;
            }

            let result;
            switch (account.platform) {
                case "facebook":
                    result = await publishToFacebook(post, {...account, accessToken: validToken });
                    break;
                case "youtube":
                    result = await publishToYouTube(post, {...account, accessToken: validToken });
                    break;
                case "instagram":
                    result = await publishToInstagram(post, {...account, accessToken: validToken });
                    break;
                case "tiktok":
                    result = await publishToTikTok(post, {...account, accessToken: validToken });
                    break;
                default:
                    throw new Error(`Unsupported platform: ${account.platform}`);
            }

            results[target] = {
                success: true,
                platform: account.platform,
                accountName: account.accountName,
                postId: result.id
            };

            logInfo(`? Successfully published to ${account.platform}: ${account.accountName}`);

        } catch (err) {
            results[target] = {
                success: false,
                error: err.message,
                requiresReauth: err.message.includes('401') || err.message.includes('unauthorized')
            };
            logError(`Publish failed for account ${target}: ${err.message}`);
        }
    }

    return results;
}

async function publishToFacebook(post, account) {
    const { content = '' } = post;
    const tokenToUse = account.accessToken;
    const pageId = account.accountId;
    const endpoint = pageId === 'me' ? 'me/feed' : `${pageId}/feed`;

    try {
        const response = await axios.post(
            `https://graph.facebook.com/v18.0/${endpoint}`,
            new URLSearchParams({
                message: content || 'Posted with FlowPost',
                access_token: tokenToUse,
            }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return { success: true, id: response.data.id };
    } catch (error) {
        const msg = error.response ?.data ?.error ?.message || error.message;
        throw new Error(`Facebook publish failed: ${msg}`);
    }
}

async function publishToInstagram(post, account) {
    const { content = '', mediaUrls = [] } = post;
    if (!mediaUrls || mediaUrls.length === 0) {
        throw new Error('Instagram publishing requires at least one media URL');
    }

    const tokenToUse = account.accessToken;
    const instagramAccountId = account.accountId;
    const primaryMediaUrl = mediaUrls[0];
    const mediaType = parseMediaType(primaryMediaUrl);

    try {
        const createParams = new URLSearchParams({
            caption: content || '',
            access_token: tokenToUse,
        });
        if (mediaType === 'video') {
            createParams.append('video_url', primaryMediaUrl);
        } else {
            createParams.append('image_url', primaryMediaUrl);
        }

        const createResponse = await axios.post(
            `https://graph.facebook.com/v16.0/${instagramAccountId}/media`,
            createParams.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const creationId = createResponse.data.id;
        const publishResponse = await axios.post(
            `https://graph.facebook.com/v16.0/${instagramAccountId}/media_publish`,
            new URLSearchParams({ creation_id: creationId, access_token: tokenToUse }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return { success: true, id: publishResponse.data.id };
    } catch (error) {
        const msg = error.response ?.data ?.error ?.message || error.message;
        throw new Error(`Instagram publish failed: ${msg}`);
    }
}

async function publishToYouTube(post, account) {
    const { content = '', mediaUrls = [] } = post;
    if (!mediaUrls || mediaUrls.length === 0) {
        throw new Error('YouTube publishing requires at least one video file');
    }
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error('YouTube OAuth credentials are not configured');
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const tmpPath = await downloadUrlToTempFile(mediaUrls[0]);
    try {
        const response = await youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: (content || 'FlowPost upload').substring(0, 100),
                    description: content || '',
                    tags: [],
                },
                status: {
                    privacyStatus: 'private',
                },
            },
            media: {
                body: fs.createReadStream(tmpPath),
            },
        });
        return { success: true, id: response.data.id };
    } catch (error) {
        const msg = error.message || 'Unknown error';
        throw new Error(`YouTube publish failed: ${msg}`);
    } finally {
        try {
            fs.unlinkSync(tmpPath);
        } catch (_) {
            // ignore cleanup errors
        }
    }
}

async function publishToTikTok(post, account) {
    const { content = '', mediaUrls = [] } = post;
    if (!mediaUrls || mediaUrls.length === 0) {
        throw new Error('TikTok publishing requires at least one video file');
    }

    const tmpPath = await downloadUrlToTempFile(mediaUrls[0]);
    try {
        const form = new FormData();
        form.append('video', fs.createReadStream(tmpPath));
        const uploadRes = await axios.post(
            `https://open-api.tiktok.com/video/upload/?open_id=${encodeURIComponent(account.accountId)}&access_token=${encodeURIComponent(account.accessToken)}`,
            form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity }
        );

        const videoId = uploadRes.data ?.data ?.video_id || uploadRes.data ?.data ?.videoId;
        if (!videoId) {
            throw new Error(uploadRes.data ?.message || 'TikTok upload failed');
        }

        const publishRes = await axios.post(
            `https://open-api.tiktok.com/video/publish/?open_id=${encodeURIComponent(account.accountId)}&access_token=${encodeURIComponent(account.accessToken)}`,
            new URLSearchParams({ video_id: videoId, text: content || 'Published with FlowPost' }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const tiktokVideoId = publishRes.data ?.data ?.video_id || publishRes.data ?.data ?.videoId;
        return { success: true, id: tiktokVideoId || videoId };
    } catch (error) {
        const msg = error.message || 'Unknown error';
        throw new Error(`TikTok publish failed: ${msg}`);
    } finally {
        try {
            fs.unlinkSync(tmpPath);
        } catch (_) {
            // ignore cleanup errors
        }
    }
}

module.exports = { publishToPlatforms };
