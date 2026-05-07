const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// The secret key for encryption/decryption
const SECRET_KEY = 'Ab3$kL9!zXw2@Rp8#Ty7&Ui4$Vm1*Ns0'; // This should be the same as in env file

// Path to the env file
const envPath = path.join(__dirname, 'routes', 'env');
const encPath = path.join(__dirname, 'routes', 'env.enc');

// Read the env file
const envContent = fs.readFileSync(envPath, 'utf8');

// Encrypt the content
const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv(algorithm, key, iv);
let encrypted = cipher.update(envContent, 'utf8', 'hex');
encrypted += cipher.final('hex');

// Save iv and encrypted data
const data = iv.toString('hex') + ':' + encrypted;
fs.writeFileSync(encPath, data);

console.log('Env file encrypted and saved to env.enc');
