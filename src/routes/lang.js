const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const config = require('../config.js');

router.get('/:lang?', function (req, res, next) {
    req.session.lang = req.params.lang || config.lang;
    res.redirect('back');
});

module.exports = router;
