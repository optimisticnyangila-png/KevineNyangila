require("dotenv").config(); // ✅ MUST be first

const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const cloudinary = require("cloudinary").v2;
const cookieParser = require("cookie-parser");
const admin = require("firebase-admin");

// Load ENV Variables
dotenv.config({
    override: false,
    path: path.join(__dirname, ".env"),
});

const { requestLogger, error: logError, info: logInfo, warn: logWarn } = require("./utils/logger");
const SocketManager = require("./utils/socketManager");

// --- Firebase Admin Initialization ---
function getFirebaseServiceAccount() {
    return process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) : null;
}

const firebaseServiceAccount = getFirebaseServiceAccount();
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || (firebaseServiceAccount && firebaseServiceAccount.project_id);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: firebaseServiceAccount ? admin.credential.cert(firebaseServiceAccount) : admin.credential.applicationDefault(),
        projectId: firebaseProjectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
}
const db = admin.firestore();

// Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY || process.env.API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET,
});

const app = express();
const server = require('http').createServer(app);
const socketManager = new SocketManager(server);
app.locals.socketManager = socketManager;

const redisPublishQueue = require("./utils/redisPublishQueue");
const rateLimiter = require("./middleware/rateLimiter");

// Security Checks
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32)) {
    logError('Server startup failed: JWT_SECRET is missing or too short for production');
    process.exit(1);
}

const PORT = process.env.PORT || 5000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const allowedOrigins = (process.env.CORS_ORIGINS || frontendOrigin).split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => (!origin || allowedOrigins.includes(origin)) ? callback(null, true) : callback(new Error('CORS blocked')),
    credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(requestLogger);
app.use(rateLimiter);

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/connect-platform", require("./routes/oauth"));
app.use("/platforms", require("./routes/platforms"));
app.use("/create-post", require("./routes/createPost"));
app.use("/schedule-post", require("./routes/schedulePost"));
app.use("/publish-post", require("./routes/publishPost"));

// --- Optimized Scheduler ---
const schedulerEnabled = process.env.SCHEDULER_ENABLED !== "false" && Boolean(firebaseProjectId);

if (process.env.NODE_ENV !== "test" && schedulerEnabled) {
    const cron = require("node-cron");

    cron.schedule("* * * * *", async () => {
        try {
            const now = new Date();
            const scheduledPosts = await db.collection("scheduledPosts")
                .where("scheduledTime", "<=", now)
                .get();

            for (const doc of scheduledPosts.docs) {
                const scheduledRef = db.collection("scheduledPosts").doc(doc.id);
                try {
                    const post = await db.runTransaction(async (transaction) => {
                        const snapshot = await transaction.get(scheduledRef);
                        if (!snapshot.exists || snapshot.data().processing) return null;

                        transaction.update(scheduledRef, {
                            processing: true,
                            processingStartedAt: new Date()
                        });
                        return snapshot.data();
                    });

                    if (!post) continue;

                    // Enqueue to Redis for background processing
                    try {
                        await redisPublishQueue.enqueuePosts(post.uid, [{ id: doc.id, ...post }], post.targets || []);
                        logInfo("Scheduled post enqueued to Redis", { postId: doc.id });

                        // ONLY delete after successful enqueue
                        await scheduledRef.delete();
                    } catch (enqueueError) {
                        logError("Failed to enqueue scheduled post to Redis", { postId: doc.id, error: enqueueError.message });
                        // Reset processing flag so it can be retried by the next cron run
                        await scheduledRef.update({
                            processing: false,
                            lastError: `Queue error: ${enqueueError.message}`,
                            lastAttemptAt: new Date()
                        });
                    }
                } catch (error) {
                    logError("Error processing scheduled post transaction", { postId: doc.id, error: error.message });
                }
            }
        } catch (error) {
            logError("Scheduler scan failed", { error: error.message });
        }
    });
}

app.get("/", (req, res) => res.send(`FlowPost API active — frontend: ${frontendOrigin}`));
app.get("/health", (req, res) => res.send("ok"));

app.use((err, req, res, next) => {
    logError("Unhandled error", { error: err.message, path: req.originalUrl });
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: "Server error" });
});

module.exports = { app, server, socketManager, redisPublishQueue };

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`FlowPost API running on port ${PORT}`);
        console.log(`WebSocket server ready for real-time updates`);
    });
}

process.on("unhandledRejection", (reason) => logError("Unhandled Rejection", { error: String(reason) }));
process.on("uncaughtException", (error) => {
    logError("Uncaught Exception", { error: error.message });
    if (process.env.NODE_ENV === "production") process.exit(1);
});
