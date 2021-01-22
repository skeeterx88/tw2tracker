const express = require('express')
const router = express.Router()
const connectEnsureLogin = require('connect-ensure-login')

const db = require('../db.js')
const sql = require('../sql.js')
const utils = require('../utils.js')
const config = require('../config.js')
const enums = require('../enums.js')
const syncSocket = require('../sync-socket.js')

router.use(connectEnsureLogin.ensureLoggedIn())

const adminPanelRouter = utils.asyncRouter(async function (req, res) {
    const openWorlds = await db.any(sql.getOpenWorlds)
    const closedWorlds = await db.any(sql.getClosedWorlds)
    const markets = await db.any(sql.markets.all)
    const development = process.env.NODE_ENV === 'development'

    res.render('admin', {
        title: `Admin Panel - ${config.site_name}`,
        openWorlds,
        closedWorlds,
        markets,
        backendValues: {
            development
        },
        ...utils.ejsHelpers
    })
})

const scrapeAllWorldsRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_DATA_ALL
    }))

    res.end()
})

const scrapeWorldRouter = utils.asyncRouter(async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const enabledMarkets = await db.map(sql.markets.withAccount, [], market => market.id)
    const worlds = await db.map(sql.getWorlds, [], world => world.num)
    
    if (enabledMarkets.includes(marketId) && worlds.includes(worldNumber)) {
        syncSocket.send(JSON.stringify({
            code: enums.SYNC_REQUEST_SYNC_DATA,
            marketId,
            worldNumber
        }))
    }
    
    res.end()
})

const scrapeMarketsRouter = utils.asyncRouter(async function (req, res) {
    syncSocket.send(JSON.stringify({
        code: enums.SYNC_REQUEST_SYNC_MARKETS
    }))

    res.end()
})

router.get('/', adminPanelRouter)
router.get('/scraper/all-worlds', scrapeAllWorldsRouter)
router.get('/scraper/:marketId/:worldNumber', scrapeWorldRouter)
router.get('/scraper/markets', scrapeMarketsRouter)

module.exports = router
