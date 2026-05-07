process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'test-bucket';
process.env.BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || `http://localhost:${process.env.BACKEND_PORT || 5000}`;
