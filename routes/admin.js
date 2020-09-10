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

        if (!marketCount.length) {
            await db.query(sql.addMarket, [market])
        }

        await db.query(sql.updateMarket, [
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

router.get('/sync-markets', /*ensureLoggedIn,*/ async function (req, res) {
    const addedMarkets = await Sync.markets()

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(addedMarkets))
})

router.post('/change-settings', /*ensureLoggedIn,*/ async function (req, res) {
    const response = {}

    const siteName = req.body['site-name']
    const adminPassword = req.body['admin-password']
    const scrapperAllowBarbarians = req.body['scrapper-allow-barbarians']
    const scrapperIntervalMinutes = req.body['scrapper-interval-minutes']

    if (siteName.length < 1) {
        response.success = false
        response.reason = 'invalid site name'
    } else if (adminPassword.length < 3) {
        response.success = false
        response.reason = 'invalid admin password'
    } else {
        await db.query(sql.updateSettings, [
            siteName,
            adminPassword,
            scrapperAllowBarbarians,
            scrapperIntervalMinutes
        ])

        response.success = true
        response.reason = 'settings updated successfully'
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

module.exports = router
