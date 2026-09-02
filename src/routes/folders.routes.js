const express = require('express');
const foldersController = require('../controllers/folders.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// All folder routes require authentication
router.use(protect);

router.post('/', foldersController.createFolder);
router.get('/root', foldersController.getRoot);
router.get('/all', foldersController.getAllFolders);
router.get('/hidden', foldersController.getHiddenItems);
router.get('/:id', foldersController.getFolder);
router.patch('/:id', foldersController.updateFolder);
router.delete('/:id', foldersController.deleteFolder);
router.post('/:id/copy', foldersController.copyFolder);

module.exports = router;
