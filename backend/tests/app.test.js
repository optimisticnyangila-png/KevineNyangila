const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockUserDoc = {
    exists: true,
    data: () => ({
        facebook: { access_token: 'facebook-token' },
        instagram: null,
        youtube: { refresh_token: 'youtube-refresh' },
        tiktok: null,
    }),
};

const mockFirestore = {
    collection: jest.fn((name) => ({
        doc: jest.fn(() => ({
            get: jest.fn(async() => (name === 'users' ? mockUserDoc : { exists: false })),
            set: jest.fn(async() => {}),
            update: jest.fn(async() => {}),
            delete: jest.fn(async() => {}),
        })),
        where: jest.fn(() => ({
            get: jest.fn(async() => ({ empty: true, size: 0, docs: [] })),
            limit: jest.fn(() => ({
                get: jest.fn(async() => ({ empty: true, docs: [] })),
            })),
        })),
        add: jest.fn(async() => ({ id: 'mock-doc-id' })),
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
        verifyIdToken: jest.fn(async() => ({ uid: 'test-user', email: 'test@example.com' })),
    })),
}));

jest.mock('../utils/redisPublishQueue', () => ({
    enqueuePosts: jest.fn(async() => [{ id: 'job-1', postId: 'post-1', status: 'queued' }]),
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

function authHeader() {
    const token = jwt.sign({ uid: 'test-user', email: 'test@example.com' }, process.env.JWT_SECRET);
    return `Bearer ${token}`;
}

describe('Backend health check', () => {
    test('GET /health returns ok', async() => {
        const res = await request(app).get('/health');
        expect(res.statusCode).toBe(200);
        expect(res.text).toBe('ok');
    });
});

describe('Platforms API', () => {
    test('GET /platforms requires authentication', async() => {
        const res = await request(app).get('/platforms');
        expect(res.statusCode).toBe(401);
    });

    test('GET /platforms should return status object for authenticated users', async() => {
        const res = await request(app)
            .get('/platforms')
            .set('Authorization', authHeader());

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('facebook');
        expect(res.body).toHaveProperty('youtube');
        expect(res.body).toHaveProperty('instagram');
        expect(res.body).toHaveProperty('tiktok');
    });

    test('GET /platform-accounts requires authentication', async() => {
        const res = await request(app).get('/platforms/platform-accounts');
        expect(res.statusCode).toBe(401);
    });
});
