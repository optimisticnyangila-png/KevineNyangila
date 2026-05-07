const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { validatePostPayload } = require('../utils/requestValidation');
const admin = require('firebase-admin');
const db = admin.firestore();
const router = express.Router();

router.post('/', authMiddleware, async(req, res) => {
    const validation = validatePostPayload(req.body);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join('; ') });
    }

    const { content, mediaUrls, targets } = validation.value;
    const uid = req.user.uid;
    const postId = db.collection('posts').doc().id;

    try {
        await db.collection('posts').doc(postId).set({
            uid,
            content,
            mediaUrls,
            targets,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        res.json({ postId });
    } catch (error) {
        console.error('Create post error', error);
        res.status(500).json({ error: 'Unable to create post' });
    }
});

function serializeDoc(doc) {
    const d = doc.data();
    return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt && typeof d.createdAt.toDate === 'function' ? d.createdAt.toDate().toISOString() : d.createdAt,
        updatedAt: d.updatedAt && typeof d.updatedAt.toDate === 'function' ? d.updatedAt.toDate().toISOString() : d.updatedAt,
    };
}

router.get('/', authMiddleware, async(req, res) => {
    try {
        const uid = req.user.uid;
        const postsSnap = await db.collection('posts').where('uid', '==', uid).get();
        const scheduledSnap = await db.collection('scheduledPosts').where('uid', '==', uid).get();
        const scheduledPostIds = new Set(scheduledSnap.docs.map((doc) => doc.id));

        const postsData = postsSnap.docs.map((doc) => {
            const data = serializeDoc(doc);
            data.scheduled = scheduledPostIds.has(doc.id);
            return data;
        });

        postsData.sort((a, b) => {
            const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return tb - ta;
        });

        res.json({ posts: postsData });
    } catch (error) {
        console.error('Load draft posts error', error);
        res.status(500).json({ error: 'Unable to load drafts' });
    }
});

router.put('/:postId', authMiddleware, async(req, res) => {
    try {
        const validation = validatePostPayload(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join('; ') });
        }

        const { postId } = req.params;
        const { content, mediaUrls, targets } = validation.value;
        const uid = req.user.uid;

        const postRef = db.collection('posts').doc(postId);
        const postSnap = await postRef.get();
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        const post = postSnap.data();
        if (post.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await postRef.update({
            content,
            mediaUrls,
            targets,
            updatedAt: new Date(),
        });

        const scheduledRef = db.collection('scheduledPosts').doc(postId);
        const scheduledSnap = await scheduledRef.get();
        if (scheduledSnap.exists) {
            await scheduledRef.update({
                content,
                mediaUrls,
                targets,
                updatedAt: new Date(),
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Edit post error', error);
        res.status(500).json({ error: 'Unable to update post' });
    }
});

router.delete('/:postId', authMiddleware, async(req, res) => {
    try {
        const { postId } = req.params;
        const uid = req.user.uid;

        const postRef = db.collection('posts').doc(postId);
        const postSnap = await postRef.get();
        if (!postSnap.exists) {
            return res.status(404).json({ error: 'Post not found' });
        }
        const post = postSnap.data();
        if (post.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await postRef.delete();
        await db.collection('scheduledPosts').doc(postId).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('Delete post error', error);
        res.status(500).json({ error: 'Unable to delete post' });
    }
});

module.exports = router;
