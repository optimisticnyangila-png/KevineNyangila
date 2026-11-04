const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok'];

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function isValidEmail(value) {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) {
        return false;
    }

    try {
        const url = new URL(value);
        // Enforce HTTPS in production for better security
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
            return false;
        }
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function validateTargets(targets) {
    return Array.isArray(targets) &&
           targets.length > 0 &&
           targets.every((target) => typeof target === 'string' && /^[a-zA-Z0-9_\-]+$/.test(target));
}

function validatePostPayload(body) {
    const errors = [];
    const content = normalizeString(body.content);
    const mediaUrls = normalizeArray(body.mediaUrls).map(normalizeString).filter(Boolean);
    const targets = normalizeArray(body.targets).map(normalizeString).filter(Boolean);

    if (!content && mediaUrls.length === 0) {
        errors.push('Content or mediaUrls is required');
    }

    if (content.length > 5000) {
        errors.push('Content must be 5000 characters or fewer');
    }

    if (mediaUrls.some((url) => !isValidUrl(url))) {
        errors.push('mediaUrls must contain valid URLs (HTTPS required in production)');
    }

    if (!validateTargets(targets)) {
        errors.push('targets must be an array of valid account IDs (alphanumeric, underscore, hyphen)');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: { content, mediaUrls, targets },
    };
}

function validateSchedulePayload(body) {
    const errors = [];
    const postId = normalizeString(body.postId);
    const scheduledTime = normalizeString(body.scheduledTime);

    if (!postId || !/^[a-zA-Z0-9_\-]+$/.test(postId)) {
        errors.push('A valid postId is required');
    }

    const date = new Date(scheduledTime);
    if (!scheduledTime || Number.isNaN(date.getTime())) {
        errors.push('scheduledTime must be a valid ISO date string');
    } else if (date <= new Date()) {
        errors.push('scheduledTime must be a future date');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: { postId, scheduledTime: date },
    };
}

function validatePublishPayload(body) {
    const errors = [];
    const postId = normalizeString(body.postId);

    if (!postId || !/^[a-zA-Z0-9_\-]+$/.test(postId)) {
        errors.push('A valid postId is required');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: { postId },
    };
}

function validateAuthPayload(body) {
    const errors = [];
    const email = normalizeString(body.email);
    const password = normalizeString(body.password);

    if (!email || !isValidEmail(email)) {
        errors.push('A valid email address is required');
    }

    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: { email, password },
    };
}

module.exports = {
    validatePostPayload,
    validateSchedulePayload,
    validatePublishPayload,
    validateAuthPayload,
    ALLOWED_PLATFORMS,
};
