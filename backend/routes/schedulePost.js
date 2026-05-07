const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { validateSchedulePayload } = require('../utils/requestValidation');
const admin = require('firebase-admin');
const db = admin.firestore();
const router = express.Router();

router.post('/', authMiddleware, async(req, res) => {
    try {
        const validation = validateSchedulePayload(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join('; ') });
        }

        const { postId, scheduledTime } = validation.value;
        const uid = req.user.uid;

        const scheduledDate = new Date(scheduledTime);
        if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
            return res.status(400).json({ error: 'scheduledTime must be a valid future date' });
        }

        const postSnap = await db.collection('posts').doc(postId).get();
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        const post = postSnap.data();
        if (post.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const existingSchedule = await db.collection('scheduledPosts').doc(postId).get();
        if (existingSchedule.exists) {
            return res.status(400).json({ error: 'This post is already scheduled' });
        }

        await db.collection('scheduledPosts').doc(postId).set({
            ...post,
            scheduledTime: scheduledDate,
            updatedAt: new Date(),
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Schedule post error', error);
        res.status(500).json({ error: 'Unable to schedule post' });
    }
});

function serializeScheduled(doc) {
    const d = doc.data();
    return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt && typeof d.createdAt.toDate === 'function' ? d.createdAt.toDate().toISOString() : d.createdAt,
        updatedAt: d.updatedAt && typeof d.updatedAt.toDate === 'function' ? d.updatedAt.toDate().toISOString() : d.updatedAt,
        scheduledTime: d.scheduledTime && typeof d.scheduledTime.toDate === 'function' ? d.scheduledTime.toDate().toISOString() : d.scheduledTime,
    };
}

router.get('/', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const snap = await db.collection('scheduledPosts').where('uid', '==', uid).get();
        const posts = snap.docs.map(serializeScheduled);
        posts.sort((a, b) => {
            const ta = a.scheduledTime ? new Date(a.scheduledTime).getTime() : 0;
            const tb = b.scheduledTime ? new Date(b.scheduledTime).getTime() : 0;
            return ta - tb;
        });
        res.json({ posts });
    } catch (error) {
        console.error('Load scheduled posts error', error);
        res.status(500).json({ error: 'Unable to load scheduled posts' });
    }
});

router.delete('/:postId', authMiddleware, async(req, res) => {
    try {
        const { postId } = req.params;
        const uid = req.user.uid;

        const scheduledRef = db.collection('scheduledPosts').doc(postId);
        const scheduledSnap = await scheduledRef.get();
        if (!scheduledSnap.exists) {
            return res.status(404).json({ error: 'Scheduled post not found' });
        }

        const scheduledPost = scheduledSnap.data();
        if (scheduledPost.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await scheduledRef.delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Unschedule post error', error);
        res.status(500).json({ error: 'Unable to cancel scheduled post' });
    }
});

module.exports = router;
