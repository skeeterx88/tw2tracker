const express = require('express')
const router = express.Router()
const {db,pgp} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')
const development = process.env.NODE_ENV === 'development'
const SEARCH_CATEGORIES = ['players', 'tribes', 'villages']

router.get('/:marketId/:worldNumber', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const players = await db.any(sql.stats.worldTopPlayers, {worldId})
    const tribes = await db.any(sql.stats.worldTopTribes, {worldId})

    res.render('stats', {
        title: `Stats ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        siteName: settings.site_name,
        players,
        tribes,
        world,
        development,
        exportValues: {
            marketId,
            worldNumber,
            players,
            tribes,
            mapHighlights: tribes.slice(0, 3)
        }
    })
}))

router.get('/:marketId/:worldNumber/tribes/:tribeId', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }


    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const tribeId = parseInt(req.params.tribeId, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    let tribe

    try {
        tribe = await db.one(sql.worlds.tribe, {worldId, tribeId})
    } catch (error) {
        res.status(404)
        throw new Error('This tribe does not exist')
    }

    const worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])

    res.render('stats-tribe', {
        title: `Tribe ${tribe.name} - ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        tribe,
        exportValues: {
            marketId,
            worldNumber,
            tribe,
            mapHighlights: [tribe]
        },
        siteName: settings.site_name,
        development
    })
}))

router.get('/:marketId/:worldNumber/tribes/:tribeId/members', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const tribeId = parseInt(req.params.tribeId, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    let tribe

    try {
        tribe = await db.one(sql.worlds.tribe, {worldId, tribeId})
    } catch (error) {
        res.status(404)
        throw new Error('This tribe does not exist')
    }

    const members = await db.any(sql.worlds.tribeMembers, {worldId, tribeId})
    const world = await db.one(sql.worlds.one, [marketId, worldNumber])

    res.render('stats-tribe-members', {
        title: `Tribe ${tribe.name} - ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        members,
        exportValues: {
            marketId,
            worldNumber,
            tribe,
            mapHighlights: [tribe]
        },
        siteName: settings.site_name,
        development
    })
}))

router.get('/:marketId/:worldNumber/players/:playerId', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const playerId = parseInt(req.params.playerId, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    let player

    try {
        player = await db.one(sql.worlds.player, {worldId, playerId})
    } catch (error) {
        res.status(404)
        throw new Error('This player does not exist')
    }

    const worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])

    let tribe = false

    if (player.tribe_id) {
        tribe = await db.one(sql.worlds.tribeName, {worldId, tribeId: player.tribe_id})
    }

    res.render('stats-player', {
        title: `Tribe ${player.name} - ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        player,
        tribe,
        exportValues: {
            marketId,
            worldNumber,
            player,
            mapHighlights: [player]
        },
        siteName: settings.site_name,
        development
    })
}))

router.get('/:marketId/:worldNumber/search/:category/:query', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const category = req.params.category

    if (!SEARCH_CATEGORIES.includes(category)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const rawQuery = req.params.query

    if (rawQuery.length < 3) {
        res.status(500)
        throw new Error('Minimum search characters is 3')
    }

    if (rawQuery.length > 20) {
        res.status(500)
        throw new Error('Maximum search characters is 20')
    }

    const query = '%' + rawQuery + '%'
    const results = await db.any(sql.stats.search[category], {worldId, query})

    console.log(results)

    return res.render('world-search', {
        title: `Search "${rawQuery}" - ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        query: rawQuery,
        category,
        results,
        resultsCount: results.length,
        exportValues: {
            marketId,
            worldNumber
        },
        siteName: settings.site_name,
        development
    })
}))

module.exports = router
