const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/authMiddleware');
const { setAuthCookie, clearAuthCookie } = require('../utils/authCookie');
const { validateAuthPayload } = require('../utils/requestValidation');
const db = admin.firestore();

const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND_ORIGIN = (process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
/** Must match Google Cloud Console “Authorized redirect URIs” for login (authorization code flow). */
const GOOGLE_LOGIN_REDIRECT_URI =
    process.env.GOOGLE_LOGIN_REDIRECT_URI || `${BACKEND_ORIGIN}/auth/google/callback`;
const FACEBOOK_LOGIN_REDIRECT_URI =
    process.env.FACEBOOK_LOGIN_REDIRECT_URI || `${BACKEND_ORIGIN}/auth/facebook/callback`;

const router = express.Router();

function jwtSecret() {
    return process.env.JWT_SECRET;
}

// Signup
router.post('/signup', async(req, res) => {
    const validation = validateAuthPayload(req.body);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join('; ') });
    }

    const { email, password } = validation.value;

    try {
        // Check if user exists
        const userDoc = await db.collection('users').where('email', '==', email).get();
        if (!userDoc.empty) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save user
        const userId = db.collection('users').doc().id;
        await db.collection('users').doc(userId).set({
            email,
            password: hashedPassword,
            createdAt: new Date()
        });

        const secret = jwtSecret();
        if (!secret) {
            return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set' });
        }
        const token = jwt.sign({ uid: userId, email }, secret, { expiresIn: '24h' });
        setAuthCookie(res, token);
        res.json({
            success: true,
            message: 'Account created successfully 🎉',
            token: token,
            user: {
                id: userId,
                email: email
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
router.post('/login', async(req, res) => {
    const validation = validateAuthPayload(req.body);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join('; ') });
    }

    const { email, password } = validation.value;

    try {
        // Find user
        const userDoc = await db.collection('users').where('email', '==', email).get();
        if (userDoc.empty) {
            return res.status(400).json({ error: 'Login failed. Please check your credentials or try logging in with Google or Facebook.' });
        }

        const user = userDoc.docs[0].data();
        const userId = userDoc.docs[0].id;

        // Check password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(400).json({ error: 'Login failed. Please check your credentials or try logging in with Google or Facebook.' });
        }

        const secret = jwtSecret();
        if (!secret) {
            return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set' });
        }
        const token = jwt.sign({ uid: userId, email }, secret, { expiresIn: '24h' });
        setAuthCookie(res, token);
        res.json({
            success: true,
            message: 'Login successful. Connecting to FlowPost system...',
            token: token,
            user: {
                id: userId,
                email: email
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Logout — clear HttpOnly cookie (CSRF mitigated by SameSite=Lax for cross-site POSTs; add CSRF token for stricter setups)
router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
});

// Verify session (cookie or Bearer)
router.get('/verify', authMiddleware, (req, res) => {
    res.json({
        success: true,
        message: 'Authentication successful',
        token: req.token,
        user: {
            id: req.user.uid,
            email: req.user.email
        }
    });
});

/**
 * Google OAuth (login) — step 1: browser hits backend, backend redirects to Google.
 * Redirect URI is always the backend (/auth/google/callback), never the SPA.
 */
router.get('/google', (req, res) => {
    const secret = jwtSecret();
    if (!secret) {
        return res.status(500).send('Server misconfiguration: JWT_SECRET not set');
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(500).send('GOOGLE_CLIENT_ID not configured');
    }

    const state = jwt.sign({ t: 'login', n: crypto.randomBytes(16).toString('hex') },
        secret, { expiresIn: '10m' }
    );

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
});

/**
 * Google OAuth (login) — step 2: Google redirects here with ?code=&state=
 * Backend exchanges code, loads Google profile, issues your app JWT, then redirects to the SPA.
 */
router.get('/google/callback', async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
        const msg = errorDescription || error;
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(msg))}`);
    }

    const secret = jwtSecret();
    if (!secret) {
        return res.status(500).send('Server misconfiguration');
    }

    try {
        const decodedState = jwt.verify(state, secret);
        if (decodedState.t !== 'login') {
            return res.status(400).send('Invalid OAuth state');
        }
    } catch {
        return res.status(400).send('Invalid or expired OAuth state');
    }

    if (!code) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('missing_code')}`);
    }

    try {
        const tokenRes = await axios.post(
            process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: GOOGLE_LOGIN_REDIRECT_URI,
                grant_type: 'authorization_code',
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token: accessToken } = tokenRes.data;
        const { data: userinfo } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const email = userinfo.email;
        const googleSub = userinfo.id;
        if (!email) {
            return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('no_email')}`);
        }

        let userId;
        const existing = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!existing.empty) {
            userId = existing.docs[0].id;
            await existing.docs[0].ref.set({ googleSub, authProvider: 'google', updatedAt: new Date() }, { merge: true });
        } else {
            userId = db.collection('users').doc().id;
            await db.collection('users').doc(userId).set({
                email,
                googleSub,
                authProvider: 'google',
                createdAt: new Date(),
            });
        }

        const appToken = jwt.sign({ uid: userId, email }, secret, { expiresIn: '24h' });
        setAuthCookie(res, appToken);
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard`);
    } catch (err) {
        console.error(err.response ?.data || err.message);
        return res.redirect(
            `${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('oauth_token_exchange_failed')}`
        );
    }
});

/**
 * Facebook OAuth (login) — step 1: browser hits backend, backend redirects to Facebook.
 * Redirect URI is always the backend (/auth/facebook/callback), never the SPA.
 */
router.get('/facebook', (req, res) => {
    const secret = jwtSecret();
    if (!secret) {
        return res.status(500).send('Server misconfiguration: JWT_SECRET not set');
    }
    if (!process.env.FB_APP_ID) {
        return res.status(500).send('FB_APP_ID not configured');
    }
    if (!process.env.FB_APP_SECRET) {
        return res.status(500).send('FB_APP_SECRET not configured');
    }

    const state = jwt.sign({ t: 'login', n: crypto.randomBytes(16).toString('hex') },
        secret, { expiresIn: '10m' }
    );

    const params = new URLSearchParams({
        client_id: process.env.FB_APP_ID,
        redirect_uri: FACEBOOK_LOGIN_REDIRECT_URI,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
    });

    res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`);
});

/**
 * Facebook OAuth (login) — step 2: Facebook redirects here with ?code=&state=
 * Backend exchanges code, loads Facebook profile, issues your app JWT, then redirects to the SPA.
 */
router.get('/facebook/callback', async(req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
        const msg = errorDescription || error;
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent(String(msg))}`);
    }

    const secret = jwtSecret();
    if (!secret) {
        return res.status(500).send('Server misconfiguration');
    }

    try {
        const decodedState = jwt.verify(state, secret);
        if (decodedState.t !== 'login') {
            return res.status(400).send('Invalid OAuth state');
        }
    } catch {
        return res.status(400).send('Invalid or expired OAuth state');
    }

    if (!code) {
        return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('missing_code')}`);
    }

    try {
        const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                client_id: process.env.FB_APP_ID,
                client_secret: process.env.FB_APP_SECRET,
                redirect_uri: FACEBOOK_LOGIN_REDIRECT_URI,
                code,
            },
        });

        const { access_token: accessToken } = tokenRes.data;
        const { data: userinfo } = await axios.get('https://graph.facebook.com/v18.0/me', {
            params: {
                fields: 'id,email,name',
                access_token: accessToken,
            },
        });

        const email = userinfo.email;
        const facebookId = userinfo.id;
        if (!email) {
            return res.redirect(`${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('no_email')}`);
        }

        let userId;
        const existing = await db.collection('users').where('email', '==', email).limit(1).get();
        if (!existing.empty) {
            userId = existing.docs[0].id;
            await existing.docs[0].ref.set({ facebookId, authProvider: 'facebook', updatedAt: new Date() }, { merge: true });
        } else {
            userId = db.collection('users').doc().id;
            await db.collection('users').doc(userId).set({
                email,
                facebookId,
                authProvider: 'facebook',
                createdAt: new Date(),
            });
        }

        const token = jwt.sign({ uid: userId, email }, secret, { expiresIn: '7d' });
        setAuthCookie(res, token);

        return res.redirect(`${FRONTEND_ORIGIN}/dashboard`);
    } catch (err) {
        console.error(err.response ?.data || err.message);
        return res.redirect(
            `${FRONTEND_ORIGIN}/dashboard?error=${encodeURIComponent('facebook_oauth_failed')}`
        );
    }
});

// Firebase Auth (Google, Facebook, etc.) — verify ID token and issue same JWT as email/password flow
router.post('/firebase', async(req, res) => {
    const { idToken } = req.body;
    if (!idToken) {
        return res.status(400).json({ error: 'idToken is required' });
    }

    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const { uid, email } = decoded;
        const userRef = db.collection('users').doc(uid);
        const existing = await userRef.get();
        if (!existing.exists) {
            await userRef.set({
                email: email || '',
                createdAt: new Date(),
                authProvider: 'firebase',
            });
        }

        const secret = jwtSecret();
        if (!secret) {
            return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set' });
        }
        const token = jwt.sign({ uid, email: email || '' }, secret, { expiresIn: '24h' });
        setAuthCookie(res, token);
        res.json({ uid });
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired Firebase ID token' });
    }
});

module.exports = router;
