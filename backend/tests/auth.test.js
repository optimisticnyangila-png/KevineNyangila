const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.FB_APP_ID = 'facebook-app-id';
process.env.FB_APP_SECRET = 'facebook-app-secret';
process.env.BACKEND_ORIGIN = 'http://backend.test';
process.env.FRONTEND_ORIGIN = 'http://frontend.test';
process.env.GOOGLE_LOGIN_REDIRECT_URI = 'http://backend.test/auth/google/callback';
process.env.FACEBOOK_LOGIN_REDIRECT_URI = 'http://backend.test/auth/facebook/callback';

const users = new Map();
let idCounter = 0;

function queryByEmail(email) {
    const docs = Array.from(users.entries())
        .filter(([, user]) => user.email === email)
        .map(([id, user]) => ({
            id,
            data: () => user,
            ref: {
                set: jest.fn(async(data, options) => {
                    users.set(id, options && options.merge ? {...user, ...data } : data);
                }),
            },
        }));

    return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
    };
}

const mockFirestore = {
    collection: jest.fn((name) => ({
        doc: jest.fn((id) => {
            const docId = id || `generated-user-${++idCounter}`;
            return {
                id: docId,
                get: jest.fn(async() => ({
                    exists: users.has(docId),
                    data: () => users.get(docId),
                })),
                set: jest.fn(async(data, options) => {
                    const existing = users.get(docId) || {};
                    users.set(docId, options && options.merge ? {...existing, ...data } : data);
                }),
                update: jest.fn(async(data) => {
                    users.set(docId, {...(users.get(docId) || {}), ...data });
                }),
                delete: jest.fn(async() => {
                    users.delete(docId);
                }),
            };
        }),
        where: jest.fn((field, op, value) => ({
            get: jest.fn(async() => (name === 'users' && field === 'email' ? queryByEmail(value) : { empty: true, size: 0, docs: [] })),
            limit: jest.fn(() => ({
                get: jest.fn(async() => (name === 'users' && field === 'email' ? queryByEmail(value) : { empty: true, size: 0, docs: [] })),
            })),
        })),
        add: jest.fn(async(data) => {
            const id = `generated-doc-${++idCounter}`;
            users.set(id, data);
            return { id };
        }),
    })),
    runTransaction: jest.fn(),
};

jest.mock('firebase-admin', () => ({
    apps: [],
    initializeApp: jest.fn(),
    credential: {
        cert: jest.fn(() => ({})),
        applicationDefault: jest.fn(() => ({})),
    },
    firestore: jest.fn(() => mockFirestore),
    auth: jest.fn(() => ({
        verifyIdToken: jest.fn(async() => {
            throw new Error('not a Firebase token');
        }),
    })),
}));

jest.mock('../utils/redisPublishQueue', () => ({
    enqueuePosts: jest.fn(async() => []),
    getUserActiveJobs: jest.fn(async() => []),
    retryFailedJobs: jest.fn(async() => {}),
    cancelJob: jest.fn(async() => {}),
}));

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
    ping: jest.fn(async() => 'PONG'),
    quit: jest.fn(async() => {}),
    disconnect: jest.fn(async() => {}),
    info: jest.fn(async() => ''),
})));

jest.mock('bull', () => jest.fn().mockImplementation(() => ({
    process: jest.fn(),
    on: jest.fn(),
    add: jest.fn(async() => ({ id: 'job-1' })),
    getJobs: jest.fn(async() => []),
    close: jest.fn(async() => {}),
})));

jest.mock('../utils/socketManager', () => jest.fn().mockImplementation(() => ({
    sendPublishUpdate: jest.fn(),
    sendQueueUpdate: jest.fn(),
    sendAccountUpdate: jest.fn(),
})));

const { app } = require('../server');

beforeEach(() => {
    users.clear();
    idCounter = 0;
});

describe('Auth registration and login API', () => {
    test('POST /auth/signup creates a user, returns a JWT, and sets the auth cookie', async() => {
        const res = await request(app)
            .post('/auth/signup')
            .send({ email: 'new@example.com', password: 'password123' });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeTruthy();
        expect(res.headers['set-cookie'].join(';')).toContain('access_token=');

        const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
        expect(decoded.email).toBe('new@example.com');
    });

    test('POST /auth/login returns a usable JWT for an existing password user', async() => {
        await request(app)
            .post('/auth/signup')
            .send({ email: 'login@example.com', password: 'password123' });

        const login = await request(app)
            .post('/auth/login')
            .send({ email: 'login@example.com', password: 'password123' });

        expect(login.statusCode).toBe(200);
        expect(login.body.success).toBe(true);

        const verify = await request(app)
            .get('/auth/verify')
            .set('Authorization', `Bearer ${login.body.token}`);

        expect(verify.statusCode).toBe(200);
        expect(verify.body.success).toBe(true);
        expect(verify.body.user.email).toBe('login@example.com');
    });
});

describe('OAuth login routes', () => {
    test('GET /auth/google redirects to Google with the backend callback URL', async() => {
        const res = await request(app).get('/auth/google');

        expect(res.statusCode).toBe(302);
        const location = new URL(res.headers.location);
        expect(location.hostname).toBe('accounts.google.com');
        expect(location.searchParams.get('client_id')).toBe('google-client-id');
        expect(location.searchParams.get('redirect_uri')).toBe('http://backend.test/auth/google/callback');
        expect(location.searchParams.get('scope')).toContain('openid');
    });

    test('GET /auth/facebook redirects to Facebook with the backend callback URL', async() => {
        const res = await request(app).get('/auth/facebook');

        expect(res.statusCode).toBe(302);
        const location = new URL(res.headers.location);
        expect(location.hostname).toBe('www.facebook.com');
        expect(location.searchParams.get('client_id')).toBe('facebook-app-id');
        expect(location.searchParams.get('redirect_uri')).toBe('http://backend.test/auth/facebook/callback');
        expect(location.searchParams.get('scope')).toBe('email,public_profile');
    });
});
