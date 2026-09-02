const express = require('express');
const linksController = require('../controllers/links.controller');
const { protect, optionalAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

// GET link is public (with optional auth for auto-saving to Shared With Me)
router.get('/:token', optionalAuth, linksController.getLink);
router.get('/bundle/:token', optionalAuth, linksController.getBundleShare);

// Creating/Deleting links requires auth
router.use(protect);
router.get('/resource/:resourceType/:resourceId', linksController.getLinkForResource);
router.post('/', linksController.createLinkShare);
router.post('/bundle', linksController.createBundleShare);
router.delete('/:id', linksController.deleteLinkShare);

module.exports = router;
