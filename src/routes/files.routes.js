const express = require('express');
const filesController = require('../controllers/files.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// All file routes require authentication
router.use(protect);

router.post('/init', filesController.initFileUpload);
router.post('/complete', filesController.completeFileUpload);
router.get('/recent', filesController.getRecentFiles);
router.get('/sync/status', filesController.getDeviceSyncStatus);
router.post('/sync/log', filesController.recordDeviceSyncLog);
router.get('/:id', filesController.getFile);
router.patch('/:id', filesController.updateFile);
router.delete('/:id', filesController.deleteFile);
router.post('/:id/copy', filesController.copyFile);

// Version history routes
router.get('/:id/versions', filesController.getFileVersions);
router.post('/:id/versions/restore', filesController.restoreFileVersion);

module.exports = router;
