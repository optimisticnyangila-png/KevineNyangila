require("dotenv").config(); // ✅ MUST be first

const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const cloudinary = require("cloudinary").v2;

// --- TEMPORARILY DISABLED: ENCRYPTION ---
// const ENC_FILE = path.join(__dirname, 'routes', 'env.enc');
// const SECRET_KEY = process.env.ENV_SECRET_KEY;
// const ALGORITHM = 'aes-256-cbc';
//
// const encrypted = fs.readFileSync(ENC_FILE, { encoding: 'base64' });
// const iv = Buffer.from(encrypted.slice(0, 32), 'hex');
// const encryptedText = Buffer.from(encrypted.slice(32), 'hex');
//
// const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY, 'hex'), iv);
// let decrypted = decipher.update(encryptedText);
// decrypted = Buffer.concat([decrypted, decipher.final()]);
// const envConfig = dotenv.parse(decrypted.toString());
// for (const k in envConfig) {
//     process.env[k] = envConfig[k];
// }

// --- LOAD ENV VARIABLES (DIRECT) ---
dotenv.config({
    override: false,
    path: path.join(__dirname, ".env"),
    debug: false,
});

const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const backendOrigin = process.env.BACKEND_ORIGIN || `http://localhost:${process.env.PORT || 5000}`;
const allowedOrigins = (process.env.CORS_ORIGINS || frontendOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const cookieParser = require("cookie-parser");
const { requestLogger, error: logError, info: logInfo, warn: logWarn } = require("./utils/logger");
const SocketManager = require("./utils/socketManager");

// Firebase admin - Initialize early
const admin = require("firebase-admin");
function getFirebaseServiceAccount() {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return null;
    }
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
}

const firebaseServiceAccount = getFirebaseServiceAccount();
const firebaseProjectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    (firebaseServiceAccount && firebaseServiceAccount.project_id);

function getFirebaseCredential() {
    if (firebaseServiceAccount) {
        return admin.credential.cert(firebaseServiceAccount);
    }

    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
    if (/serviceAccountKey\.json$|google-credentials\.json$/i.test(credentialsPath)) {
        throw new Error("Do not use checked-in credential files; set FIREBASE_SERVICE_ACCOUNT_JSON in .env instead.");
    }

    return admin.credential.applicationDefault();
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: getFirebaseCredential(),
        projectId: firebaseProjectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
}
const db = admin.firestore();

// Cloudinary configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY || process.env.API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET,
});

const rateLimiter = require("./middleware/rateLimiter");
const redisPublishQueue = require("./utils/redisPublishQueue");

const app = express();
const server = require('http').createServer(app);
const socketManager = new SocketManager(server);
app.locals.socketManager = socketManager;

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-secret' : null);
if (!JWT_SECRET) {
    logError('Server startup failed: JWT_SECRET is required');
    process.exit(1);
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
    logError('Server startup failed: JWT_SECRET must be at least 32 characters in production');
    process.exit(1);
}
process.env.JWT_SECRET = JWT_SECRET;

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV === 'production' && frontendOrigin.startsWith('http://localhost')) {
    logError('Production FRONTEND_ORIGIN should be configured to a deployed frontend URL instead of localhost');
}

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "10mb" }));
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

const schedulerEnabled = process.env.SCHEDULER_ENABLED !== "false" && Boolean(firebaseProjectId);

// Cron for scheduling
if (process.env.NODE_ENV !== "test" && schedulerEnabled) {
    const cron = require("node-cron");
    const { publishToPlatforms } = require("./utils/publishUtils");
    cron.schedule("* * * * *", async() => {
        try {
            const now = new Date();
            const scheduledPosts = await db
                .collection("scheduledPosts")
                .where("scheduledTime", "<=", now)
                .get();

            // Process posts sequentially to avoid overwhelming the system
            for (const doc of scheduledPosts.docs) {
                const scheduledRef = db.collection("scheduledPosts").doc(doc.id);
                try {
                    const post = await db.runTransaction(async(transaction) => {
                        const snapshot = await transaction.get(scheduledRef);
                        if (!snapshot.exists) {
                            return null;
                        }

                        const data = snapshot.data();
                        const processingStartedAt = data.processingStartedAt ?
                            data.processingStartedAt.toDate ?
                            data.processingStartedAt.toDate() :
                            new Date(data.processingStartedAt) :
                            null;
                        const isStuck = data.processing && processingStartedAt && Date.now() - processingStartedAt.getTime() > 15 * 60 * 1000;

                        if (data.processing && !isStuck) {
                            return null;
                        }

                        transaction.update(scheduledRef, {
                            processing: true,
                            processingStartedAt: new Date(),
                            lastError: null,
                        });
                        return data;
                    });

                    if (!post) {
                        continue;
                    }

                    const result = await publishToPlatforms(post);
                    logInfo("Published scheduled post", { postId: doc.id, result });
                    await scheduledRef.delete();
                } catch (error) {
                    logError("Error publishing scheduled post", { postId: doc.id, error: error.message || String(error) });
                    await scheduledRef.update({
                        processing: false,
                        lastError: error.message || String(error),
                        lastAttemptAt: new Date(),
                    }).catch(() => {});
                }
            }
        } catch (error) {
            logError("Scheduled publishing scan failed", { error: error.message || String(error) });
        }
    });
} else if (process.env.NODE_ENV !== "test") {
    logWarn("Scheduled publishing disabled because Firebase project config is missing", {
        required: "Set FIREBASE_PROJECT_ID, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, or FIREBASE_SERVICE_ACCOUNT_JSON",
    });
}

app.get("/", (req, res) => {
    res.send(`FlowPost API — frontend: ${frontendOrigin}`);
});
app.get("/health", (req, res) => {
    res.send("ok");
});

app.use((err, req, res, next) => {
    logError("Unhandled route error", {
        error: err.message || String(err),
        path: req.originalUrl,
        method: req.method,
    });
    if (res.headersSent) {
        return next(err);
    }
    return res.status(err.status || 500).json({ error: "Server error" });
});

module.exports = { app, server, socketManager, redisPublishQueue };

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`FlowPost API on ${backendOrigin}`);
        console.log(`WebSocket server ready for real-time updates`);
    });
}

process.on("unhandledRejection", (reason) => {
    logError("Unhandled promise rejection", { error: reason && reason.message ? reason.message : String(reason) });
});

process.on("uncaughtException", (error) => {
    logError("Uncaught exception", { error: error.message, stack: error.stack });
    if (process.env.NODE_ENV === "production") {
        process.exit(1);
    }
});
