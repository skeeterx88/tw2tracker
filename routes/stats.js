const express = require('express')
const router = express.Router()
const {db,pgp} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter, hasOwn} = utils
const getSettings = require('../settings')
const development = process.env.NODE_ENV === 'development'
const SEARCH_CATEGORIES = {
    players: 'players',
    tribes: 'tribes',
    villages: 'villages'
}
const RANKING_CATEGORIES = {
    players: 'players',
    tribes: 'tribes'
}

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
        },
        ...utils.ejsHelpers
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
        development,
        ...utils.ejsHelpers
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
        development,
        ...utils.ejsHelpers
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
        development,
        ...utils.ejsHelpers
    })
}))

router.post('/:marketId/:worldNumber/search/', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const category = (req.body.category || '').toLowerCase()

    if (!hasOwn.call(SEARCH_CATEGORIES, category)) {
        res.status(404)
        throw new Error('This search category does not exist')
    }

    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    return res.redirect(307, `/stats/${marketId}/${worldNumber}/search/${category}`);
}))

router.post('/:marketId/:worldNumber/search/:category/', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const category = req.params.category

    if (!hasOwn.call(SEARCH_CATEGORIES, category)) {
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
    const rawQuery = req.body.query

    if (!rawQuery) {
        res.status(500)
        throw new Error('No search specified')
    }

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
        development,
        ...utils.ejsHelpers
    })
}))

const routerRanking = async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const category = req.params.category

    if (!hasOwn.call(RANKING_CATEGORIES, category)) {
        res.status(404)
        throw new Error('This ranking category does not exist')
    }

    const categoryUpper = category[0].toUpperCase() + category.slice(1)

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const limit = settings.ranking_items_per_page

    let players
    let tribes
    let total

    switch (category) {
        case RANKING_CATEGORIES.players: {
            players = await db.any(sql.stats.rankingPlayers, {worldId, offset, limit})
            total = (await db.one(sql.stats.playerCount, {worldId})).count
            break
        }
        case RANKING_CATEGORIES.tribes: {
            tribes = await db.any(sql.stats.rankingTribes, {worldId, offset, limit})
            total = (await db.one(sql.stats.tribeCount, {worldId})).count
            break
        }
    }

    const pagination = {}

    pagination.current = page
    pagination.last = Math.max(1, parseInt(Math.ceil(total / limit), 10))
    pagination.start = Math.max(1, pagination.current - 3)
    pagination.end = Math.min(pagination.last, pagination.current + 3)
    pagination.showAllPages = pagination.last <= 7
    pagination.showGotoLast = pagination.end < pagination.last
    pagination.showGotoFirst = pagination.start > 1
    pagination.showGotoNext = pagination.current < pagination.last
    pagination.showGotoPrev = pagination.current > 1 && pagination.last > 1

    res.render('ranking', {
        title: `${categoryUpper} Ranking - ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: world.name,
        world,
        tribes,
        players,
        category,
        categoryUpper,
        pagination,
        exportValues: {
            marketId,
            worldNumber
        },
        siteName: settings.site_name,
        development,
        ...utils.ejsHelpers
    })
}

router.get('/:marketId/:worldNumber/ranking/:category?/', asyncRouter(routerRanking))
router.get('/:marketId/:worldNumber/ranking/:category?/page/:page', asyncRouter(routerRanking))

module.exports = router
