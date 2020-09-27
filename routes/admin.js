const fs = require('fs')
const express = require('express')
const router = express.Router()
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn()

const db = require('../db')
const sql = require('../sql')
const Sync = require('../sync')

if (process.env.NODE_ENV === 'development') {
    router.get('/', ensureLoggedIn, async function (req, res) {
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
}


router.get('/scrapper/:marketId/:worldNumber', ensureLoggedIn, async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const enabledMarkets = await db.map(sql.enabledMarkets, [], market => market.id)
    const worlds = await db.map(sql.worlds, [], world => world.num)

    const response = {}

    if (!enabledMarkets.includes(marketId)) {
        response.success = false
        response.message = `market ${marketId} is invalid`
    } else if (!worlds.includes(worldNumber)) {
        response.success = false
        response.message = `world ${worldNumber} is invalid`
    } else {
        try {
            await Sync.scrappeWorld(marketId, worldNumber)
            response.message = marketId + worldNumber + ' synchronized successfully'
            response.success = true
        } catch (error) {
            response.message = error.message
            response.success = false
        }
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/scrapper/:marketId/:worldNumber/force', ensureLoggedIn, async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const enabledMarkets = await db.map(sql.enabledMarkets, [], market => market.id)
    const worlds = await db.map(sql.worlds, [], world => world.num)

    const response = {}

    if (!enabledMarkets.includes(marketId)) {
        response.success = false
        response.message = `market ${marketId} is invalid`
    } else if (!worlds.includes(worldNumber)) {
        response.success = false
        response.message = `world ${worldNumber} is invalid`
    } else {
        try {
            await Sync.scrappeWorld(marketId, worldNumber, true)
            response.message = marketId + worldNumber + ' synchronized successfully'
            response.success = true
        } catch (error) {
            response.message = error.message
            response.success = false
        }
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/scrapper/all', ensureLoggedIn, async function (req, res) {
    const response = {}

    try {
        await Sync.scrappeAllWorlds()
        response.message = 'worlds synchronized successfully'
        response.success = true
    } catch (error) {
        response.message = error.message
        response.success = false
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.post('/add-market', ensureLoggedIn, async function (req, res) {
    console.log(req.body)

    const market = req.body.market
    const accountName = req.body.accountName || null
    const accountPassword = req.body.accountPassword || null
    const accountId = req.body.accountId || null
    const accountToken = req.body.accountToken || null
    const enabled = req.body.enabled === 'on' || req.body.enabled === true

    const response = {}

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
        accountPassword,
        accountToken,
        accountId,
        enabled
    ])

    response.success = true
    response.message = marketCount.length
        ? 'market updated successfully'
        : 'market added successfully'

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/edit-market/:marketId', ensureLoggedIn, async function (req, res) {
    const marketId = req.params.marketId
    const market = await db.one(sql.market, [marketId])
    const settings = await db.one(sql.settings)

    res.render('admin-edit-market', {
        title: `Edit market ${marketId} - Admin Panel - ${settings.site_name}`,
        market: market
    })
})

router.get('/sync-markets', ensureLoggedIn, async function (req, res) {
    const addedMarkets = await Sync.markets()

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(addedMarkets))
})

router.post('/change-settings', ensureLoggedIn, async function (req, res) {
    const response = {}

    const siteName = req.body['site-name']
    const adminPassword = req.body['admin-password']
    const scrapperAllowBarbarians = req.body['scrapper-allow-barbarians']
    const scrapperIntervalMinutes = req.body['scrapper-interval-minutes']

    if (siteName.length < 1) {
        response.success = false
        response.message = 'invalid site name'
    } else if (adminPassword.length < 3) {
        response.success = false
        response.message = 'invalid admin password'
    } else {
        await db.query(sql.updateSettings, [
            siteName,
            adminPassword,
            scrapperAllowBarbarians,
            scrapperIntervalMinutes
        ])

        response.success = true
        response.message = 'settings updated successfully'
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/test-account/:marketId', ensureLoggedIn, async function (req, res) {
    const marketId = req.params.marketId
    const response = {}

    console.log('Account test on market', marketId)

    const market = await db.one(sql.market, [marketId])

    if (!market.account_name || !market.account_password) {
        response.error = 'invalid market account'
    } else {
        response.account = market.account_name

        try {
            await Sync.auth(marketId, market)
            response.working = true
        } catch (error) {
            response.working = false
        }
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

module.exports = router
