const express = require('express')
const router = express.Router()
const db = require('../db')
const sql = require('../sql')
const getSettings = require('../settings')

router.get('/', async function (req, res, next) {
    const settings = await getSettings()

    res.render('index', {
        title: `Home - ${settings.site_name}`
    })
})

module.exports = router
