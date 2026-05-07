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
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function validateTargets(targets) {
    return Array.isArray(targets) && targets.length > 0 && targets.every((target) => typeof target === 'string' && target.trim().length > 0);
}

function normalizeTargets(targets) {
    const cleanTargets = {};

    if (targets && typeof targets === 'object' && !Array.isArray(targets)) {
        for (const platform of ALLOWED_PLATFORMS) {
            if (Object.prototype.hasOwnProperty.call(targets, platform)) {
                const targetValue = normalizeString(targets[platform]);
                if (targetValue) {
                    cleanTargets[platform] = targetValue;
                }
            }
        }
    }

    return cleanTargets;
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
        errors.push('mediaUrls must contain valid https:// or http:// URLs');
    }

    if (!validateTargets(targets)) {
        errors.push('targets must be an array of at least one account ID');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: {
            content,
            mediaUrls,
            targets,
        },
    };
}

function validateSchedulePayload(body) {
    const errors = [];
    const postId = normalizeString(body.postId);
    const scheduledTime = normalizeString(body.scheduledTime);

    if (!postId) {
        errors.push('postId is required');
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
        value: {
            postId,
            scheduledTime: date,
        },
    };
}

function validatePublishPayload(body) {
    const errors = [];
    const postId = normalizeString(body.postId);

    if (!postId) {
        errors.push('postId is required');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: {
            postId,
        },
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
