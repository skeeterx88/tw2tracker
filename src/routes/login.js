const express = require('express');
const router = express.Router();
const passport = require('passport');
const config = require('../config.js');

router.get('/', async function (req, res, next) {
    const [error] = req.flash('error');

    res.render('login', {
        title: `Admin login - ${config.site_name}`,
        error
    });
});

router.post('/', passport.authenticate('local', {
    successReturnToOrRedirect: '/admin',
    failureRedirect: '/login',
    failureFlash: true
}), function (req, res) {
    res.redirect('/admin');
});

module.exports = router;
