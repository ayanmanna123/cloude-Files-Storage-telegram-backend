const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const foldersRoutes = require('./folders.routes');
const filesRoutes = require('./files.routes');
const sharesRoutes = require('./shares.routes');
const linksRoutes = require('./links.routes');
const trackingRoutes = require('./tracking.routes');
const emailRoutes = require('./email.routes');
const coreRoutes = require('./core.routes');

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/folders', foldersRoutes);
router.use('/files', filesRoutes);
router.use('/shares', sharesRoutes);
router.use('/link-shares', linksRoutes);
router.use('/tracking', trackingRoutes);
router.use('/email', emailRoutes);
router.use('/', coreRoutes); // Search, stars, trash

router.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Media Storage API' });
});

module.exports = router;

