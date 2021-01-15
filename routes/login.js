const express = require('express')
const router = express.Router()
const passport = require('passport')
const config = require('../config.js')

router.get('/', async function (req, res, next) {
    res.render('login', {
        title: `Admin login - ${config.site_name}`
    })
})

router.post('/', passport.authenticate('local', {
    successReturnToOrRedirect: '/admin',
    failureRedirect: '/login'
}), function (req, res) {
    res.redirect('/admin')
})

module.exports = router
