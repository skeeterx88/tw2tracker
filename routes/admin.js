const fs = require('fs')
const express = require('express')
const router = express.Router()
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn()

const db = require('../db')
const sql = require('../sql')
const Sync = require('../sync')

router.get('/', /*ensureLoggedIn,*/ async function (req, res) {
    const worlds = await db.any(sql.worlds)
    const settings = await db.one(sql.settings)

    // console.log(settings)

    res.render('admin', {
        title: 'Admin - tw2logan',
        worlds: worlds,
        settings: settings
    })
})

router.get('/scrapper/:market/:world', /*ensureLoggedIn,*/ async function (req, res) {
    const market = req.params.market
    const world = req.params.world

    // console.log(world)

    res.setHeader('Content-Type', 'application/json')

    const response = {}

    try {
        response.success = await Sync.scrappeWorld(market, world)
        response.reason = 'synced successfully'
    } catch (reason) {
        response.success = false
        response.reason = reason
    }

    res.end(JSON.stringify(response))
})

module.exports = router
