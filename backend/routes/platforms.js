const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const admin = require('firebase-admin');
const { info: logInfo, error: logError } = require('../utils/logger');
const db = admin.firestore();

const router = express.Router();

// ============================================
// GET /platform-accounts - Return detailed user accounts with status
// ============================================
router.get('/platform-accounts', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const snapshot = await db
            .collection("platformAccounts")
            .where("uid", "==", uid)
            .get();

        const accounts = snapshot.docs.map(doc => {
            const data = doc.data();
            const now = Date.now();
            const tokenExpiresAt = data.tokenExpiresAt ?.toMillis ?.() || data.tokenExpiresAt || null;
            const isExpired = tokenExpiresAt && tokenExpiresAt < now;

            return {
                id: doc.id,
                platform: data.platform,
                accountId: data.accountId,
                accountName: data.accountName,
                status: isExpired ? 'expired' : 'active',
                createdAt: data.createdAt ?.toDate ?.() || data.createdAt,
                tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null,
            };
        });

        // Group by platform
        const grouped = {};
        accounts.forEach(acc => {
            if (!grouped[acc.platform]) grouped[acc.platform] = [];
            grouped[acc.platform].push(acc);
        });

        logInfo(`Loaded ${accounts.length} platform accounts for user ${uid}`);
        res.json({ accounts, grouped });
    } catch (error) {
        logError(`GET /platform-accounts error: ${error.message}`);
        res.status(500).json({ error: 'Unable to load platform accounts' });
    }
});

// ============================================
// GET /platform-accounts/summary - Platform status summary (2 pages, 1 channel, etc)
// ============================================
router.get('/platform-accounts/summary', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const snapshot = await db
            .collection("platformAccounts")
            .where("uid", "==", uid)
            .get();

        const summary = {
            facebook: 0,
            instagram: 0,
            youtube: 0,
            tiktok: 0,
            total: snapshot.size,
        };

        snapshot.docs.forEach(doc => {
            const platform = doc.data().platform;
            if (summary.hasOwnProperty(platform)) {
                summary[platform]++;
            }
        });

        res.json(summary);
    } catch (error) {
        logError(`GET /platform-accounts/summary error: ${error.message}`);
        res.status(500).json({ error: 'Unable to load platform summary' });
    }
});

// ============================================
// DELETE /platform-accounts/:accountId - Disconnect a platform account
// ============================================
router.delete('/platform-accounts/:accountId', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const { accountId } = req.params;

        const doc = await db.collection('platformAccounts').doc(accountId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Account not found' });
        }

        if (doc.data().uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized: cannot delete another user\'s account' });
        }

        await db.collection('platformAccounts').doc(accountId).delete();
        logInfo(`Disconnected account ${accountId} for user ${uid}`);
        res.json({ success: true, message: 'Account disconnected' });
    } catch (error) {
        logError(`DELETE /platform-accounts error: ${error.message}`);
        res.status(500).json({ error: 'Failed to disconnect account' });
    }
});

// ============================================
// GET / - Return connected OAuth platforms (backward compatibility)
// ============================================
router.get('/', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const userSnap = await db.collection('users').doc(uid).get();
        if (!userSnap.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userSnap.data();

        // Return simple boolean status for each platform
        const platformStatus = {
            facebook: Boolean(user.facebook && (user.facebook.access_token || (user.facebook.pages && user.facebook.pages.length))),
            instagram: Boolean(user.instagram && (user.instagram.access_token || (user.instagram.accounts && user.instagram.accounts.length))),
            youtube: Boolean(user.youtube && (user.youtube.access_token || user.youtube.refresh_token)),
            tiktok: Boolean(user.tiktok && user.tiktok.access_token),
        };

        res.json(platformStatus);
    } catch (error) {
        logError(`GET /platforms error: ${error.message}`);
        res.status(500).json({ error: 'Unable to load platform status' });
    }
});

module.exports = router;
