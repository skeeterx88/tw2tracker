const express = require('express')
const router = express.Router()
const passport = require('passport')

router.get('/', function(req, res, next) {
    res.render('login', {
        title: 'Login - tw2logan'
    })
})

router.post('/', passport.authenticate('local', {
    failureRedirect: '/login'
}), function (req, res) {
    res.redirect('/admin')
})

module.exports = router
