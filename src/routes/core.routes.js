const express = require('express');
const coreController = require('../controllers/core.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

router.get('/search', coreController.search);

router.post('/stars', coreController.addStar);
router.delete('/stars', coreController.removeStar);

router.get('/trash', coreController.getTrash);
router.post('/trash/restore', coreController.restoreTrash);
router.delete('/trash/:type/:id', coreController.hardDeleteTrash);

module.exports = router;
