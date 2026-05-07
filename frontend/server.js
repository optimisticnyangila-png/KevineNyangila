const express = require('express');
const path = require('path');
const app = express();

app.get('/config.js', (req, res) => {
    const apiBaseUrl = process.env.API_BASE_URL || process.env.BACKEND_ORIGIN || `http://localhost:${process.env.BACKEND_PORT || 5000}`;
    const frontendOrigin = process.env.FRONTEND_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
    res.type('application/javascript').send(
        `window.__FLOWPOST_CONFIG__ = ${JSON.stringify({ API_BASE: apiBaseUrl, FRONTEND_ORIGIN: frontendOrigin })};`
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
