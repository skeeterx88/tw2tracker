const express = require('express')
const createError = require('http-errors')
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
        throw createError(404, 'This world does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const players = await db.any(sql.stats.worldTopPlayers, {worldId})
    const tribes = await db.any(sql.stats.worldTopTribes, {worldId})

    res.render('stats', {
        title: `${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        players,
        tribes,
        world,
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`
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
        throw createError(404, 'This world does not exist')
    }

    let tribe

    try {
        tribe = await db.one(sql.worlds.tribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])

    res.render('stats-tribe', {
        title: `Tribe ${tribe.tag} - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${world.num}/tribes/${tribe.id}">${tribe.tag}</a>`
        ],
        exportValues: {
            marketId,
            worldNumber,
            tribe,
            mapHighlights: [tribe],
            mapHighlightsType: 'tribes'
        },
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
        throw createError(404, 'This world does not exist')
    }

    let tribe

    try {
        tribe = await db.one(sql.worlds.tribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const members = await db.any(sql.worlds.tribeMembers, {worldId, tribeId})
    const world = await db.one(sql.worlds.one, [marketId, worldNumber])

    res.render('stats-tribe-members', {
        title: `Tribe ${tribe.tag} - Members - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        members,
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${world.num}/tribes/${tribe.id}">${tribe.tag}</a>`,
            `Members`
        ],
        exportValues: {
            marketId,
            worldNumber,
            tribe,
            mapHighlights: [tribe],
            mapHighlightsType: 'tribes'
        },
        ...utils.ejsHelpers
    })
}))

const tribeVillagesRouter = async function (req, res, next) {
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
        throw createError(404, 'This world does not exist')
    }

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1
    const limit = settings.ranking_items_per_page
    const offset = limit * (page - 1)

    let tribe

    try {
        tribe = await db.one(sql.worlds.tribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const allVillages = await db.any(sql.worlds.tribeVillages, {worldId, tribeId})
    const villages = allVillages.slice(offset, offset + limit)
    const total = allVillages.length

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])

    res.render('stats-tribe-villages', {
        title: `Tribe ${tribe.tag} - Villages - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        villages,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${world.num}/tribes/${tribe.id}">${tribe.tag}</a>`,
            `Villages`
        ],
        exportValues: {
            marketId,
            worldNumber,
            tribe,
            mapHighlights: [tribe],
            mapHighlightsType: 'tribes'
        },
        ...utils.ejsHelpers
    })
}

router.get('/:marketId/:worldNumber/tribes/:tribeId/villages', asyncRouter(tribeVillagesRouter))
router.get('/:marketId/:worldNumber/tribes/:tribeId/villages/page/:page', asyncRouter(tribeVillagesRouter))

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
        throw createError(404, 'This world does not exist')
    }

    let player

    try {
        player = await db.one(sql.worlds.player, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])

    let tribe = false

    if (player.tribe_id) {
        tribe = await db.one(sql.worlds.tribeName, {worldId, tribeId: player.tribe_id})
    }

    res.render('stats-player', {
        title: `Player ${player.name} - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        player,
        tribe,
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${world.num}/players/${player.id}">${player.name}</a>`
        ],
        exportValues: {
            marketId,
            worldNumber,
            player,
            mapHighlights: [player],
            mapHighlightsType: 'players'
        },
        ...utils.ejsHelpers
    })
}))

router.get('/:marketId/:worldNumber/players/:playerId/villages', asyncRouter(async function (req, res, next) {
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
        throw createError(404, 'This world does not exist')
    }

    let player
    let villages

    try {
        player = await db.one(sql.worlds.player, {worldId, playerId})
        villages = await db.any(sql.worlds.playerVillages, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])

    res.render('stats-player-villages', {
        title: `Player ${player.name} - Villages - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        player,
        villages,
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${world.num}/players/${player.id}">${player.name}</a>`,
            'Villages'
        ],
        exportValues: {
            marketId,
            worldNumber,
            player,
            mapHighlights: [player],
            mapHighlightsType: 'players'
        },
        ...utils.ejsHelpers
    })
}))

router.post('/:marketId/:worldNumber/search/', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const rawQuery = encodeURIComponent(req.body.query)
    const category = (req.body.category || '').toLowerCase()

    if (!hasOwn.call(SEARCH_CATEGORIES, category)) {
        throw createError(404, 'This search category does not exist')
    }

    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    return res.redirect(303, `/stats/${marketId}/${worldNumber}/search/${category}/${rawQuery}`);
}))

router.get('/:marketId/:worldNumber/search/', asyncRouter(async function (req, res, next) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    return res.redirect(302, `/stats/${marketId}/${worldNumber}`);
}))

const routerSearch = async function (req, res, next) {
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
        throw createError(404, 'This world does not exist')
    }

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1
    const limit = settings.ranking_items_per_page
    const offset = limit * (page - 1)

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const rawQuery = decodeURIComponent(req.params.query)

    if (!rawQuery) {
        throw createError(500, 'No search specified')
    }

    if (rawQuery.length < 3) {
        throw createError(500, 'Minimum search characters is 3')
    }

    if (rawQuery.length > 20) {
        throw createError(500, 'Maximum search characters is 20')
    }

    const query = '%' + rawQuery + '%'
    const allResults = await db.any(sql.stats.search[category], {worldId, query})
    const results = allResults.slice(offset, offset + limit)
    const total = allResults.length

    return res.render('search', {
        title: `Search "${rawQuery}" - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        category,
        results,
        resultsCount: results.length,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Search "${rawQuery}"`
        ],
        exportValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
}

router.get('/:marketId/:worldNumber/search/:category/:query', asyncRouter(routerSearch))
router.get('/:marketId/:worldNumber/search/:category/:query/page/:page', asyncRouter(routerSearch))

const routerRanking = async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const category = req.params.category

    if (!hasOwn.call(RANKING_CATEGORIES, category)) {
        throw createError(404, 'This ranking category does not exist')
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
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
            total = await db.one(sql.stats.playerCount, {worldId})
            total = parseInt(total.count, 10)
            break
        }
        case RANKING_CATEGORIES.tribes: {
            tribes = await db.any(sql.stats.rankingTribes, {worldId, offset, limit})
            total = await db.one(sql.stats.tribeCount, {worldId})
            total = parseInt(total.count, 10)
            break
        }
    }

    const capitalizedCategory = utils.capitalize(category)

    res.render('ranking', {
        title: `${capitalizedCategory} Ranking - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: world.name,
        world,
        tribes,
        players,
        category,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">${settings.site_name}</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Ranking / ${capitalizedCategory}`
        ],
        exportValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
}

router.get('/:marketId/:worldNumber/ranking/:category?/', asyncRouter(routerRanking))
router.get('/:marketId/:worldNumber/ranking/:category?/page/:page', asyncRouter(routerRanking))

module.exports = router
