const admin = require('firebase-admin');
const { validatePostPayload, validateSchedulePayload } = require('../utils/requestValidation');
const db = admin.firestore();

// --- Helper Functions ---
function serializeDoc(doc) {
    const d = doc.data();
    return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt && typeof d.createdAt.toDate === 'function' ? d.createdAt.toDate().toISOString() : d.createdAt,
        updatedAt: d.updatedAt && typeof d.updatedAt.toDate === 'function' ? d.updatedAt.toDate().toISOString() : d.updatedAt,
    };
}

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

// --- Draft Posts ---
exports.createPost = async(req, res) => {
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
};

exports.getDraftPosts = async(req, res) => {
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
};

exports.updatePost = async(req, res) => {
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
};

exports.deletePost = async(req, res) => {
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
};

// --- Scheduled Posts ---
exports.schedulePost = async(req, res) => {
    try {
        const validation = validateSchedulePayload(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join('; ') });
        }

        const { postId, scheduledTime } = validation.value;
        const uid = req.user.uid;

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
            scheduledTime,
            updatedAt: new Date(),
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Schedule post error', error);
        res.status(500).json({ error: 'Unable to schedule post' });
    }
};

exports.getScheduledPosts = async(req, res) => {
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
};

exports.unschedulePost = async(req, res) => {
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
};
