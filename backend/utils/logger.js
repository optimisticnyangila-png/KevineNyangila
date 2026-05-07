const fs = require('fs');
const path = require('path');
const { createLogger, transports, format } = require('winston');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize({ all: false }),
                format.printf(({ level, message, timestamp, ...meta }) => {
                    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${level}] ${message}${metaString}`;
                })
            )
        }),
        new transports.File({ filename: path.join(logDir, 'app.log'), level: 'info' }),
        new transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' })
    ]
});

function info(message, meta = {}) {
    logger.info(message, meta);
}

function warn(message, meta = {}) {
    logger.warn(message, meta);
}

function error(message, meta = {}) {
    logger.error(message, meta);
}

function requestLogger(req, res, next) {
    const startTime = Date.now();
    const requestId = `${Math.floor(Math.random() * 1e9)}`;

    res.on('finish', () => {
        info('http_request', {
            requestId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Date.now() - startTime,
            ip: req.ip,
            userId: req.user?.uid || null,
        });
    });

    next();
}

module.exports = {
    info,
    warn,
    error,
    requestLogger,
};
