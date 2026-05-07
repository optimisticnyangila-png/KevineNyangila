/**
 * HttpOnly cookie options for JWT session.
 * JWT is never readable from document.cookie in the browser.
 */
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'access_token';

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function baseCookieOptions() {
    const options = {
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? 'none' : 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
    };

    if (process.env.AUTH_COOKIE_DOMAIN) {
        options.domain = process.env.AUTH_COOKIE_DOMAIN;
    }

    return options;
}

function setAuthCookie(res, token) {
    res.cookie(COOKIE_NAME, token, baseCookieOptions());
}

/** Options must align with setAuthCookie so the browser clears the right cookie. */
function clearAuthCookie(res) {
    const options = {
        path: '/',
        httpOnly: true,
        secure: isProduction(),
        sameSite: isProduction() ? 'none' : 'lax',
    };

    if (process.env.AUTH_COOKIE_DOMAIN) {
        options.domain = process.env.AUTH_COOKIE_DOMAIN;
    }

    res.clearCookie(COOKIE_NAME, options);
}

module.exports = {
    COOKIE_NAME,
    setAuthCookie,
    clearAuthCookie,
    baseCookieOptions,
};
