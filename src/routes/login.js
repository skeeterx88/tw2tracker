const express = require('express');
const router = express.Router();
const passport = require('passport');
const config = require('../config.js');
const i18n = require('../i18n.js');

router.get('/', async function (req, res, next) {
    const [error] = req.flash('error');

    res.render('login', {
        title: i18n('admin_panel_login', 'page_titles', res.locals.lang, [config.site_name]),
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
