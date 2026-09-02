const express = require('express');
const sharesController = require('../controllers/shares.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

router.post('/', sharesController.createShare);
router.get('/me', sharesController.getSharedWithMe);
router.get('/:resourceType/:resourceId', sharesController.getShares);
router.delete('/:id', sharesController.deleteShare);

module.exports = router;
