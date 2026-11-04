const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const platformsController = require('../controllers/platformsController');

const router = express.Router();

router.get('/platform-accounts', authMiddleware, platformsController.getPlatformAccounts);
router.get('/platform-accounts/summary', authMiddleware, platformsController.getPlatformSummary);
router.delete('/platform-accounts/:accountId', authMiddleware, platformsController.disconnectAccount);
router.get('/', authMiddleware, platformsController.getPlatformStatusLegacy);

module.exports = router;
