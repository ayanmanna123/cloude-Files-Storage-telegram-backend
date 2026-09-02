const express = require('express');
const usersController = require('../controllers/users.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

router.get('/search', usersController.searchUsers);

module.exports = router;
