const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookie');
const { validateAuthPayload } = require('../utils/requestValidation');
const db = admin.firestore();

const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

const GOOGLE_LOGIN_REDIRECT_URI = process.env.GOOGLE_LOGIN_REDIRECT_URI || `${BACKEND_ORIGIN}/auth/google/callback`;
const FACEBOOK_LOGIN_REDIRECT_URI = process.env.FACEBOOK_LOGIN_REDIRECT_URI || `${BACKEND_ORIGIN}/auth/facebook/callback`;

function jwtSecret() {
    return process.env.JWT_SECRET;
}

exports.signup = async(req, res) => {
    const validation = validateAuthPayload(req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.errors.join('; ') });

    const { email, password } = validation.value;
    try {
        const userDoc = await db.collection('users').where('email', '==', email).get();
        if (!userDoc.empty) return res.status(400).json({ error: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = db.collection('users').doc().id;
        await db.collection('users').doc(userId).set({ email, password: hashedPassword, createdAt: new Date() });

        const token = jwt.sign({ uid: userId, email }, jwtSecret(), { expiresIn: '24h' });
        setAuthCookie(res, token);
        res.json({ success: true, message: 'Account created successfully 🎉', token, user: { id: userId, email } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.login = async(req, res) => {
    const validation = validateAuthPayload(req.body);
    if (!validation.valid) return res.status(400).json({ error: validation.errors.join('; ') });

    const { email, password } = validation.value;
    try {
        const userDoc = await db.collection('users').where('email', '==', email).get();
        if (userDoc.empty) return res.status(400).json({ error: 'Login failed. Check credentials.' });

        const user = userDoc.docs[0].data();
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(400).json({ error: 'Login failed. Check credentials.' });

        const token = jwt.sign({ uid: userDoc.docs[0].id, email }, jwtSecret(), { expiresIn: '24h' });
        setAuthCookie(res, token);
        res.json({ success: true, message: 'Login successful', token, user: { id: userDoc.docs[0].id, email } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.logout = (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
};

exports.verify = (req, res) => {
    res.json({ success: true, token: req.token, user: { id: req.user.uid, email: req.user.email } });
};

exports.googleAuth = (req, res) => {
    const state = jwt.sign({ t: 'login', n: crypto.randomBytes(16).toString('hex') }, jwtSecret(), { expiresIn: '10m' });
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_LOGIN_REDIRECT_URI,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
};

exports.googleCallback = async(req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(error)}`);

    try {
        const decodedState = jwt.verify(state, jwtSecret());
        if (decodedState.t !== 'login') throw new Error('Invalid state');

        const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_LOGIN_REDIRECT_URI,
            grant_type: 'authorization_code',
        }));

        const { access_token } = tokenRes.data;
        const { data: userinfo } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const { email, id: googleSub } = userinfo;
        let userId;
        const existing = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!existing.empty) {
            userId = existing.docs[0].id;
            await existing.docs[0].ref.set({ googleSub, authProvider: 'google', updatedAt: new Date() }, { merge: true });
        } else {
            userId = db.collection('users').doc().id;
            await db.collection('users').doc(userId).set({ email, googleSub, authProvider: 'google', createdAt: new Date() });
        }

        setAuthCookie(res, jwt.sign({ uid: userId, email }, jwtSecret(), { expiresIn: '24h' }));
        res.redirect(`${FRONTEND_ORIGIN}/dashboard`);
    } catch (err) {
        res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=oauth_failed`);
    }
};

exports.facebookAuth = (req, res) => {
    if (!process.env.FB_APP_ID) return res.status(500).send('FB_APP_ID not configured');
    const state = jwt.sign({ t: 'login', n: crypto.randomBytes(16).toString('hex') }, jwtSecret(), { expiresIn: '10m' });
    const params = new URLSearchParams({
        client_id: process.env.FB_APP_ID,
        redirect_uri: FACEBOOK_LOGIN_REDIRECT_URI,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
    });
    res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`);
};

exports.facebookCallback = async(req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(error)}`);

    try {
        jwt.verify(state, jwtSecret());
        const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: { client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, redirect_uri: FACEBOOK_LOGIN_REDIRECT_URI, code },
        });

        const { access_token } = tokenRes.data;
        const { data: userinfo } = await axios.get('https://graph.facebook.com/v18.0/me', {
            params: { fields: 'id,email,name', access_token },
        });

        const { email, id: facebookId } = userinfo;
        if (!email) return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=no_email`);

        let userId;
        const existing = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!existing.empty) {
            userId = existing.docs[0].id;
            await existing.docs[0].ref.set({ facebookId, authProvider: 'facebook', updatedAt: new Date() }, { merge: true });
        } else {
            userId = db.collection('users').doc().id;
            await db.collection('users').doc(userId).set({ email, facebookId, authProvider: 'facebook', createdAt: new Date() });
        }

        setAuthCookie(res, jwt.sign({ uid: userId, email }, jwtSecret(), { expiresIn: '7d' }));
        res.redirect(`${FRONTEND_ORIGIN}/dashboard`);
    } catch (err) {
        res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=facebook_oauth_failed`);
    }
};

exports.firebaseAuth = async(req, res) => {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const { uid, email } = decoded;
        const userRef = db.collection('users').doc(uid);
        const existing = await userRef.get();
        if (!existing.exists) {
            await userRef.set({ email: email || '', createdAt: new Date(), authProvider: 'firebase' });
        }

        const token = jwt.sign({ uid, email: email || '' }, jwtSecret(), { expiresIn: '24h' });
        setAuthCookie(res, token);
        res.json({ uid });
    } catch (error) {
        res.status(401).json({ error: 'Invalid Firebase ID token' });
    }
};
