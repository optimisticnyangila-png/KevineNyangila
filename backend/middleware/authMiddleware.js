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
        const secret = process.env.JWT_SECRET;
        const decodedHeader = jwt.decode(token, { complete: true });
        const alg = decodedHeader && decodedHeader.header && decodedHeader.header.alg;

        // Synchronous app JWT check for HS256 algorithm tokens
        if (alg === 'HS256' && secret) {
            try {
                const decoded = jwt.verify(token, secret);
                req.user = decoded;
                req.token = token;
                return next();
            } catch (jwtErr) {
                // Fallthrough if token verification failed
            }
        }

        // Check Firebase ID token if RS256 or issuer matches Firebase
        if (authHeader && authHeader.startsWith('Bearer ') && admin.apps.length) {
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.user = decoded;
                req.token = token;
                return next();
            } catch (firebaseErr) {
                // Fallthrough to standard JWT verification
            }
        }

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
