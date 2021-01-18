const express = require('express')
const router = express.Router()
const WebSocket = require('ws')
const ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn()

const {db} = require('../db.js')
const sql = require('../sql.js')
const utils = require('../utils.js')
const Sync = require('../sync.js')
const config = require('../config.js')
const syncStatus = require('../sync-status.js')
const enums = require('../enums.js')
const Events = require('../events.js')

const IGNORE_LAST_SYNC = 'ignore_last_sync'

const syncStates = {
    START: 'start',
    FINISH: 'finish',
    UPDATE: 'update'
}

const socketServer = new WebSocket.Server({port: 7777})

socketServer.on('connection', function connection(ws) {
    function send(data) {
        ws.send(JSON.stringify(data))
    }

    Events.on(enums.SCRAPPE_WORLD_START, function (worldId) {
        send([syncStates.START, {
            worldId
        }])
    })

    Events.on(enums.SCRAPPE_WORLD_END, function (worldId, status, date) {
        send([syncStates.FINISH, {
            worldId,
            status,
            date
        }])
    })

    send([syncStates.UPDATE, syncStatus.getCurrent()])
})

router.get('/', ensureLoggedIn, async function (req, res) {
    const openWorlds = await db.any(sql.getOpenWorlds)
    const closedWorlds = await db.any(sql.getClosedWorlds)
    const markets = await db.any(sql.markets.all)

    res.render('admin', {
        title: `Admin Panel - ${config.site_name}`,
        openWorlds,
        closedWorlds,
        markets,
        ...utils.ejsHelpers
    })
})

router.get('/scrapper/status', ensureLoggedIn, async function (req, res) {
    const response = syncStatus.getCurrent()

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/scrapper/all/:flag?', ensureLoggedIn, async function (req, res) {
    const response = {}
    const flag = req.params.flag === 'force' ? IGNORE_LAST_SYNC : false

    try {
        await Sync.allWorlds(flag)
        response.message = 'worlds synchronized successfully'
        response.success = true
    } catch (error) {
        response.message = error.message
        response.success = false
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.get('/scrapper/:marketId/:worldNumber', ensureLoggedIn, async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const enabledMarkets = await db.map(sql.markets.withAccount, [], market => market.id)
    const worlds = await db.map(sql.getWorlds, [], world => world.num)

    const response = {}

    if (!enabledMarkets.includes(marketId)) {
        response.success = false
        response.message = `market ${marketId} is invalid`
    } else if (!worlds.includes(worldNumber)) {
        response.success = false
        response.message = `world ${worldNumber} is invalid`
    } else {
        try {
            await Sync.world(marketId, worldNumber)
            response.message = `${marketId}${worldNumber} synchronized successfully`
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
    const enabledMarkets = await db.map(sql.markets.withAccount, [], market => market.id)
    const worlds = await db.map(sql.getWorlds, [], world => world.num)

    const response = {}

    if (!enabledMarkets.includes(marketId)) {
        response.success = false
        response.message = `market ${marketId} is invalid`
    } else if (!worlds.includes(worldNumber)) {
        response.success = false
        response.message = `world ${worldNumber} is invalid`
    } else {
        try {
            await Sync.world(marketId, worldNumber, IGNORE_LAST_SYNC)
            response.message = `${marketId}${worldNumber} synchronized successfully`
            response.success = true
        } catch (error) {
            response.message = error.message
            response.success = false
        }
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

    const marketCount = await db.any(sql.markets.one, market)

    if (!marketCount.length) {
        await db.query(sql.addMarket, [market])
    }

    await db.query(sql.markets.update, [
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
    const market = await db.one(sql.markets.one, [marketId])

    res.render('admin-edit-market', {
        title: `Edit market ${marketId} - Admin Panel - ${config.site_name}`,
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
        await db.query(sql.settings.update, [
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

    const market = await db.one(sql.markets.one, [marketId])

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
