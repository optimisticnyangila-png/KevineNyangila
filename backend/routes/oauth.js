const express = require('express');
const oauthController = require('../controllers/oauthController');

const router = express.Router();

// --- YouTube ---
router.get('/youtube/authorize', oauthController.authorizeYouTube);
router.get('/google/callback', oauthController.youtubeCallback);

// --- Facebook ---
router.get('/facebook/authorize', oauthController.authorizeFacebook);
router.get('/facebook/callback', oauthController.facebookCallback);

// --- Instagram ---
router.get('/instagram/authorize', oauthController.authorizeInstagram);
router.get('/instagram/callback', oauthController.instagramCallback);

// --- TikTok ---
router.get('/tiktok/authorize', oauthController.authorizeTikTok);
router.get('/tiktok/callback', oauthController.tiktokCallback);

module.exports = router;
