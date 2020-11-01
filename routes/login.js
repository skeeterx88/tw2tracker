const express = require('express')
const router = express.Router()
const passport = require('passport')

const getSettings = require('../settings')

router.get('/', async function (req, res, next) {
    const settings = await getSettings()

    res.render('login', {
        title: `Admin login - ${settings.site_name}`
    })
})

router.post('/', passport.authenticate('local', {
    successReturnToOrRedirect: '/admin',
    failureRedirect: '/login'
}), function (req, res) {
    res.redirect('/admin')
})

module.exports = router
