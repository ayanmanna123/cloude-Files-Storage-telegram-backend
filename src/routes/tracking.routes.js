const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/tracking.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware.protect);

router.post('/open', trackingController.trackOpen);
router.get('/recent', trackingController.getRecentItems);

module.exports = router;
