const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { info: logInfo, warn: logWarn } = require('./logger');

/**
 * WebSocket Manager for Real-time Dashboard Updates
 */
class SocketManager {
    constructor(server) {
        const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);

        this.io = socketIo(server, {
            cors: {
                origin: allowedOrigins,
                credentials: true
            }
        });

        this.userSockets = new Map(); // uid -> Set of socket IDs
        this.socketUsers = new Map(); // socket ID -> uid

        this.setupMiddleware();
        this.setupEventHandlers();
    }

    /**
     * Setup authentication middleware
     */
    setupMiddleware() {
        this.io.use(async(socket, next) => {
            try {
                const token = socket.handshake.auth.token || socket.handshake.query.token;

                if (!token) {
                    return next(new Error('Authentication token required'));
                }

                const secret = process.env.JWT_SECRET || process.env.ENV_SECRET_KEY;
                if (!secret) {
                    return next(new Error('JWT secret not configured'));
                }

                const decoded = jwt.verify(token, secret);
                socket.uid = decoded.uid;
                socket.userId = decoded.uid; // For compatibility

                next();
            } catch (error) {
                logWarn('Socket authentication failed', { error: error.message });
                next(new Error('Authentication failed'));
            }
        });
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            const uid = socket.uid;
            logInfo(`User ${uid} connected via WebSocket`);

            // Track user connections
            if (!this.userSockets.has(uid)) {
                this.userSockets.set(uid, new Set());
            }
            this.userSockets.get(uid).add(socket.id);
            this.socketUsers.set(socket.id, uid);

            // Join user-specific room
            socket.join(`user:${uid}`);

            // Handle disconnect
            socket.on('disconnect', () => {
                logInfo(`User ${uid} disconnected from WebSocket`);
                const userSockets = this.userSockets.get(uid);
                if (userSockets) {
                    userSockets.delete(socket.id);
                    if (userSockets.size === 0) {
                        this.userSockets.delete(uid);
                    }
                }
                this.socketUsers.delete(socket.id);
            });

            // Handle ping for connection health
            socket.on('ping', () => {
                socket.emit('pong');
            });

            // Handle subscription to specific post updates
            socket.on('subscribe:post', (postId) => {
                socket.join(`post:${postId}`);
                logInfo(`User ${uid} subscribed to post ${postId}`);
            });

            // Handle unsubscription
            socket.on('unsubscribe:post', (postId) => {
                socket.leave(`post:${postId}`);
                logInfo(`User ${uid} unsubscribed from post ${postId}`);
            });
        });
    }

    /**
     * Send update to specific user
     */
    emitToUser(uid, event, data) {
        this.io.to(`user:${uid}`).emit(event, data);
    }

    /**
     * Send update to users watching specific post
     */
    emitToPostWatchers(postId, event, data) {
        this.io.to(`post:${postId}`).emit(event, data);
    }

    /**
     * Broadcast to all connected users (admin use)
     */
    broadcast(event, data) {
        this.io.emit(event, data);
    }

    /**
     * Get connection count for user
     */
    getUserConnectionCount(uid) {
        return this.userSockets.get(uid) ?.size || 0;
    }

    /**
     * Get total connected users
     */
    getTotalConnectedUsers() {
        return this.userSockets.size;
    }

    /**
     * Send publish status update
     */
    sendPublishUpdate(uid, postId, status, data = {}) {
        const update = {
            postId,
            status,
            timestamp: new Date(),
            ...data
        };

        this.emitToUser(uid, 'publish:update', update);
        this.emitToPostWatchers(postId, 'post:update', update);
    }

    /**
     * Send queue status update
     */
    sendQueueUpdate(uid, queueData) {
        this.emitToUser(uid, 'queue:update', {
            timestamp: new Date(),
            ...queueData
        });
    }

    /**
     * Send account status update
     */
    sendAccountUpdate(uid, accountData) {
        this.emitToUser(uid, 'account:update', {
            timestamp: new Date(),
            ...accountData
        });
    }

    /**
     * Send bulk operation progress
     */
    sendBulkProgress(uid, operationId, progress) {
        this.emitToUser(uid, 'bulk:progress', {
            operationId,
            timestamp: new Date(),
            ...progress
        });
    }
}

module.exports = SocketManager;
