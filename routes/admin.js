const fs = require('fs')
const express = require('express')
const router = express.Router()
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn()

const db = require('../db')
const sql = require('../sql')
const Sync = require('../sync')

router.get('/', /*ensureLoggedIn,*/ async function (req, res) {
    const worlds = await db.any(sql.worlds)
    const markets = await db.any(sql.markets)
    const settings = await db.one(sql.settings)

    res.render('admin', {
        title: 'Admin Panel - ' + settings.site_name,
        worlds: worlds,
        markets: markets,
        settings: settings
    })
})

router.get('/scrapper/:market/:world', /*ensureLoggedIn,*/ async function (req, res) {
    const market = req.params.market
    const world = parseInt(req.params.world, 10)
    const enabledMarkets = await db.map(sql.enabledMarkets, [], market => market.id)
    const enabledWorlds = await db.map(sql.enabledWorlds, [], world => world.id)

    const response = {}

    if (!enabledMarkets.includes(market)) {
        response.success = false
        response.reason = `market ${market} is invalid`
    } else if (!enabledWorlds.includes(world)) {
        response.success = false
        response.reason = `world ${world} is invalid`
    } else {
        try {
            response.success = await Sync.scrappeWorld(market, req.params.world)
            response.reason = 'synced successfully'
        } catch (error) {
            response.success = false
            response.reason = error.message
        }
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.post('/add-market', /*ensureLoggedIn,*/ async function (req, res) {
    console.log(req.body)

    const market = req.body.market
    const accountName = req.body.accountName
    const accountId = req.body.accountId
    const accountToken = req.body.accountToken
    const enabled = req.body.enabled === 'on' || req.body.enabled === true

    const response = {}

    if (market.length < 2) {
        response.success = false
        response.reason = 'invalid market id'
    } else if (accountName.length < 4 || accountName.length > 24) {
        response.success = false
        response.reason = 'invalid account name'
    } else if (isNaN(accountId)) {
        response.success = false
        response.reason = 'invalid account id'
    } else if (accountToken.length !== 40) {
        response.success = false
        response.reason = 'invalid account token'
    } else {
        const marketCount = await db.any(sql.market, market)
        const query = marketCount.length
            ? sql.updateMarket
            : sql.addMarket

        await db.query(query, [
            market,
            accountName,
            accountToken,
            accountId,
            enabled
        ])

        response.success = true
        response.reason = marketCount.length
            ? 'market updated successfully'
            : 'market added successfully'
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/edit-market/:marketId', /*ensureLoggedIn,*/ async function (req, res) {
    const marketId = req.params.marketId
    const market = await db.one(sql.market, [marketId])
    const settings = await db.one(sql.settings)

    res.render('admin-edit-market', {
        title: `Edit market ${marketId} - Admin Panel - ${settings.site_name}`,
        market: market
    })
})

module.exports = router
