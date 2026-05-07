const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { COOKIE_NAME } = require('../utils/authCookie');

/**
 * Verifies Firebase ID token from Authorization header, or falls back to app JWT from HttpOnly cookie.
 */
module.exports = async(req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token && req.cookies) {
        token = req.cookies[COOKIE_NAME];
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.user = decoded;
                req.token = token;
                return next();
            } catch (firebaseErr) {
                // Fallback to app JWT if Authorization header contains the app token.
            }
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            return res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set' });
        }

        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        req.token = token;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};
