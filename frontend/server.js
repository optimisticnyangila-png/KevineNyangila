const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadEnvFile(path.join(__dirname, '.env'));

app.get('/config.js', (req, res) => {
    const apiBaseUrl = process.env.API_BASE_URL || process.env.BACKEND_ORIGIN || 'https://flowpost-backed.onrender.com';
    const frontendOrigin = process.env.FRONTEND_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
    const apiKey = process.env.API_KEY || process.env.FIREBASE_API_KEY || '';

    res.type('application/javascript').send(
        `window.__FLOWPOST_CONFIG__ = ${JSON.stringify({ API_BASE: apiBaseUrl, FRONTEND_ORIGIN: frontendOrigin, API_KEY: apiKey })};`
    );
});

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Handle all routes by serving index.html (for SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Frontend server running on http://localhost:${PORT}`);
});
