const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')
const {db} = require('../db')
const sql = require('../sql')

const {
    paramWorld,
    paramWorldParse,
    paramMarket
} = require('../router-helpers.js')

const rankingsRouter = require('./stats-rankings.js')
const searchRouter = require('./stats-search.js')
const villagesRouter = require('./stats-villages.js')
const playersRouter = require('./stats-players.js')
const tribesRouter = require('./stats-tribes.js')
const conquestsRouter = require('./stats-conquests.js')

const marketsRouter = asyncRouter(async function (req, res, next) {
    const settings = await getSettings()
    const worlds = await db.any(sql.getWorlds)
    const marketsIds = Array.from(new Set(worlds.map(world => world.market)))

    const marketStats = marketsIds.map(function (id) {
        return {
            id,
            players: worlds.reduce((base, next) => next.market === id ? base + next.player_count : base, 0),
            tribes: worlds.reduce((base, next) => next.market === id ? base + next.tribe_count : base, 0),
            villages: worlds.reduce((base, next) => next.market === id ? base + next.village_count : base, 0),
            openWorld: worlds.filter((world) => world.market === id && world.open).length,
            closedWorld: worlds.filter((world) => world.market === id && !world.open).length
        }
    })

    res.render('stats/servers', {
        title: settings.site_name,
        marketStats,
        navigation: [
            `<a href="/stats">Stats</a>`,
            'Server List'
        ],
        ...utils.ejsHelpers
    })
})

const worldsRouter = asyncRouter(async function (req, res, next) {
    if (!paramMarket(req)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const syncedWorlds = await db.any(sql.getSyncedWorlds)
    const marketWorlds = syncedWorlds.filter((world) => world.market === marketId)

    if (!marketWorlds.length) {
        throw createError(404, 'This server does not exist or does not have any available world')
    }

    const sortedWorlds = marketWorlds.sort((a, b) => a.num - b.num)
    const worlds = [
        ['Open Worlds', sortedWorlds.filter(world => world.open)],
        ['Closed Worlds', sortedWorlds.filter(world => !world.open)]
    ]

    res.render('stats/worlds', {
        title: `${marketId.toUpperCase()} - ${settings.site_name}`,
        marketId,
        worlds,
        navigation: [
            `<a href="/stats">Stats</a>`,
            `Server <a href="/stats/${marketId}">${marketId.toUpperCase()}</a>`,
            `World List`
        ],
        exportValues: {
            marketId
        },
        ...utils.ejsHelpers
    })
})

const worldRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const settings = await getSettings()

    const [
        world,
        players,
        tribes,
        lastConquests
    ] = await Promise.all([
        db.one(sql.getWorld, [marketId, worldNumber]),
        db.any(sql.getWorldTopPlayers, {worldId}),
        db.any(sql.getWorldTopTribes, {worldId}),
        db.any(sql.getWorldLastConquests, {worldId})
    ])

    res.render('stats/world', {
        title: `${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        players,
        tribes,
        world,
        lastConquests,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>${!world.open ? ' (Closed)' : ''}`
        ],
        exportValues: {
            marketId,
            worldNumber,
            players,
            tribes,
            mapHighlights: tribes.slice(0, 3),
            mapHighlightsType: 'tribes'
        },
        ...utils.ejsHelpers
    })
})

router.get('/', marketsRouter)
router.get('/stats', marketsRouter)
router.get('/stats/:marketId', worldsRouter)
router.get('/stats/:marketId/:worldNumber', worldRouter)
router.use(rankingsRouter)
router.use(searchRouter)
router.use(villagesRouter)
router.use(playersRouter)
router.use(tribesRouter)
router.use(conquestsRouter)

module.exports = router
