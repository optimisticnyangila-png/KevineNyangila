const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Encrypt a string using AES-256-GCM
 * @param {string} text - The text to encrypt
 * @returns {string} - The encrypted text in format iv:content:tag
 */
function encrypt(text) {
    if (!text) return null;

    const secret = process.env.TOKEN_ENCRYPTION_KEY;
    if (!secret || secret.length < 32) {
        throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 characters');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(secret, 'utf8').slice(0, 32), iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
}

/**
 * Decrypt a string using AES-256-GCM
 * @param {string} encryptedText - The encrypted text in format iv:content:tag
 * @returns {string} - The decrypted text
 */
function decrypt(encryptedText) {
    if (!encryptedText) return null;

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        // Fallback for unencrypted tokens (if any exist during migration)
        return encryptedText;
    }

    const secret = process.env.TOKEN_ENCRYPTION_KEY;
    const [ivHex, content, tagHex] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(secret, 'utf8').slice(0, 32), iv);

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

module.exports = { encrypt, decrypt };
