const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const {db} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const achievementTitles = require('../achievement-titles.json')
const {asyncRouter, hasOwn} = utils
const getSettings = require('../settings')
const SEARCH_CATEGORIES = {
    players: 'players',
    tribes: 'tribes',
    villages: 'villages'
}
const RANKING_CATEGORIES = {
    players: 'players',
    tribes: 'tribes'
}
const conquestTypes = {
    GAIN: 'gain',
    LOSS: 'loss',
    SELF: 'self'
}
const tribeMemberChangeTypes = {
    LEFT: 'left',
    JOIN: 'join'
}

const homeRouter = asyncRouter(async function (req, res, next) {
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

router.get('/', homeRouter)
router.get('/stats', homeRouter)

router.get('/stats/:marketId', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const syncedWorlds = await db.any(sql.getSyncedWorlds)
    const marketWorlds = syncedWorlds.filter((world) => world.market === marketId)
    const sortedWorlds = marketWorlds.sort((a, b) => a.num - b.num)

    if (!marketWorlds.length) {
        throw createError(404, 'This server does not exist or does not have any available world')
    }

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
}))

router.get('/stats/:marketId/:worldNumber', asyncRouter(async function (req, res, next) {
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
}))

const conquestsRouter = asyncRouter(async function (req, res, next) {
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

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

    const world = await db.one(sql.getWorld, [marketId, worldNumber])
    const conquests = await db.any(sql.getWorldConquests, {worldId, offset, limit})
    const total = parseInt((await db.one(sql.getWorldConquestsCount, {worldId})).count, 10)

    res.render('stats/conquests', {
        title: `${marketId.toUpperCase()}/${world.name} - Conquests - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        conquests,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            'Conquests'
        ],
        exportValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
})

router.get('/stats/:marketId/:worldNumber/conquests', conquestsRouter)
router.get('/stats/:marketId/:worldNumber/conquests/page/:page', conquestsRouter)

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId', asyncRouter(async function (req, res, next) {
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
        tribe = await db.one(sql.getTribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    let conquestCount = await db.one(sql.getTribeConquestsCount, {worldId, tribeId})
    conquestCount[conquestTypes.GAIN] = parseInt(conquestCount[conquestTypes.GAIN], 10)
    conquestCount[conquestTypes.LOSS] = parseInt(conquestCount[conquestTypes.LOSS], 10)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribe.id})
    const achievementsLatest = achievements.slice(0, 5)

    let achievementsRepeatableCount = achievements.reduce(function (sum, {period, type, level}) {
        return period ? sum + 1 : sum
    }, 0)

    const memberChangesCount = (await db.one(sql.getTribeMemberChangesCount, {worldId, id: tribeId})).count

    res.render('stats/tribe', {
        title: `Tribe ${tribe.tag} - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        conquestCount,
        conquestTypes,
        achievementsRepeatableCount,
        achievementTitles,
        achievementsLatest,
        memberChangesCount,
        navigation: [
            `<a href="/">Stats</a>`,
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

const tribeConquestsRouter = asyncRouter(async function (req, res, next) {
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
        tribe = await db.one(sql.getTribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let conquests
    let total
    let navigationTitle = ['Conquests']

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

    switch (req.params.type) {
        case undefined: {
            conquests = await db.any(sql.getTribeConquests, {worldId, tribeId, offset, limit})
            total = await db.one(sql.getTribeConquestsCount, {worldId, tribeId})
            total = total[conquestTypes.GAIN] + total[conquestTypes.LOSS]
            break
        }
        case conquestTypes.GAIN: {
            conquests = await db.any(sql.getTribeConquestsGain, {worldId, tribeId, offset, limit})
            total = (await db.one(sql.getTribeConquestsGainCount, {worldId, tribeId})).count
            navigationTitle.push('Gains')
            break
        }
        case conquestTypes.LOSS: {
            conquests = await db.any(sql.getTribeConquestsLoss, {worldId, tribeId, offset, limit})
            total = (await db.one(sql.getTribeConquestsLossCount, {worldId, tribeId})).count
            navigationTitle.push('Losses')
            break
        }
        default: {
            throw createError(404, 'This conquests sub page does not exist')
        }
    }

    conquests = conquests.map(function (conquest) {
        if (conquest.new_owner_tribe_id === conquest.old_owner_tribe_id) {
            conquest.type = conquestTypes.SELF
        } else if (conquest.new_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.GAIN
        } else if (conquest.old_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.LOSS
        }


        return conquest
    })

    navigationTitle = navigationTitle.join(' ')

    res.render('stats/tribe-conquests', {
        title: `Tribe ${tribe.tag} - Conquests - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        conquests,
        conquestTypes,
        navigationTitle,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${world.num}/tribes/${tribe.id}">${tribe.tag}</a>`,
            navigationTitle
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
})

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:type?', tribeConquestsRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:type?/page/:page', tribeConquestsRouter)

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/members', asyncRouter(async function (req, res, next) {
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
        tribe = await db.one(sql.getTribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const members = await db.any(sql.getTribeMembers, {worldId, tribeId})
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/tribe-members', {
        title: `Tribe ${tribe.tag} - Members - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        members,
        navigation: [
            `<a href="/">Stats</a>`,
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

const tribeVillagesRouter = asyncRouter(async function (req, res, next) {
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
        tribe = await db.one(sql.getTribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const allVillages = await db.any(sql.getTribeVillages, {worldId, tribeId})
    const villages = allVillages.slice(offset, offset + limit)
    const total = allVillages.length

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/tribe-villages', {
        title: `Tribe ${tribe.tag} - Villages - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        villages,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
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
})

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages', tribeVillagesRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages/page/:page', tribeVillagesRouter)

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/member-changes', asyncRouter(async function (req, res, next) {
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
        tribe = await db.one(sql.getTribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const playersName = {}
    const memberChangesRaw = await db.any(sql.getTribeMemberChanges, {worldId, id: tribeId})
    const memberChanges = []

    for (let change of memberChangesRaw) {
        if (!hasOwn.call(playersName, change.character_id)) {
            playersName[change.character_id] = (await db.one(sql.getPlayer, {worldId, playerId: change.character_id})).name
        }

        memberChanges.push({
            player: {
                id: change.character_id,
                name: playersName[change.character_id]
            },
            type: change.old_tribe === tribeId ? tribeMemberChangeTypes.LEFT : tribeMemberChangeTypes.JOIN,
            date: change.date
        })
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/tribe-member-changes', {
        title: `Tribe ${tribe.tag} - Member Changes - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        changeIndex: memberChanges.length,
        memberChanges,
        tribeMemberChangeTypes,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${world.num}/tribes/${tribe.id}">${tribe.tag}</a>`,
            `Member Changes`
        ],
        exportValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
}))

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/achievements/:sub_category?', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const tribeId = parseInt(req.params.tribeId, 10)
    const subCategory = req.params.sub_category

    if (subCategory && subCategory !== 'detailed') {
        throw createError(404, 'This achievement sub-category does not exist')
    }

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    let tribe

    try {
        tribe = await db.one(sql.getTribe, {worldId, tribeId})
    } catch (error) {
        throw createError(404, 'This tribe does not exist')
    }

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribeId})
    const achievementsRepeatable = {}
    const achievementsRepeatableCount = {}
    const achievementsRepeatableLastEarned = {}
    const achievementsRepeatableDetailed = {}

    for (let {period, type, time_last_level} of achievements) {
        if (period) {
            if (!achievementsRepeatableLastEarned[type]) {
                achievementsRepeatableLastEarned[type] = utils.ejsHelpers.formatDate(time_last_level, 'day-only')
            }

            achievementsRepeatable[type] = achievementsRepeatable[type] || []
            achievementsRepeatable[type].push(utils.ejsHelpers.formatDate(time_last_level, 'day-only'))

            achievementsRepeatableCount[type] = achievementsRepeatableCount[type] ?? 0
            achievementsRepeatableCount[type]++

            if (subCategory === 'detailed') {
                achievementsRepeatableDetailed[type] = achievementsRepeatableDetailed[type] || []
                achievementsRepeatableDetailed[type].push(utils.ejsHelpers.formatDate(time_last_level, 'day-only'))
            }
        }
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/tribe-achievements', {
        title: `Tribe ${tribe.tag} - Achievements - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        achievementsRepeatable,
        achievementsRepeatableCount,
        achievementsRepeatableLastEarned,
        achievementsRepeatableDetailed,
        subCategory,
        achievementTitles,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${world.num}/tribes/${tribe.id}">${tribe.tag}</a>`,
            'Achievements'
        ],
        exportValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
}))

router.get('/stats/:marketId/:worldNumber/players/:playerId', asyncRouter(async function (req, res, next) {
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
        player = await db.one(sql.getPlayer, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    let conquestCount = await db.one(sql.getPlayerConquestCount, {worldId, playerId})
    conquestCount[conquestTypes.GAIN] = parseInt(conquestCount[conquestTypes.GAIN], 10)
    conquestCount[conquestTypes.LOSS] = parseInt(conquestCount[conquestTypes.LOSS], 10)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let tribe = false

    if (player.tribe_id) {
        tribe = await db.one(sql.getTribe, {worldId, tribeId: player.tribe_id})
    }

    const achievementTypes = Object.fromEntries(await db.map(sql.achievementTypes, {}, (achievement) => [achievement.name, achievement]))
    const achievements = await db.any(sql.getPlayerAchievements, {worldId, id: playerId})
    const achievementsLatest = achievements.slice(0, 5)

    let achievementPoints = achievements.reduce(function (sum, {type, level}) {
        const {milestone, points} = achievementTypes[type]
        
        if (!points) {
            return sum
        }

        return milestone
            ? sum + points[level - 1]
            : sum + points.slice(0, level).reduce((sum, next) => sum + next, 0)
    }, 0)

    const tribeChangesCount = (await db.one(sql.getPlayerTribeChangesCount, {worldId, id: playerId})).count

    res.render('stats/player', {
        title: `Player ${player.name} - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        player,
        tribe,
        conquestCount,
        conquestTypes,
        achievementPoints,
        achievementTitles,
        achievementsLatest,
        achievementTypes,
        tribeChangesCount,
        navigation: [
            `<a href="/">Stats</a>`,
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

router.get('/stats/:marketId/:worldNumber/players/:character_id/villages', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const playerId = parseInt(req.params.character_id, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    let player
    let villages

    try {
        player = await db.one(sql.getPlayer, {worldId, playerId})
        villages = await db.any(sql.getPlayerVillages, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/player-villages', {
        title: `Player ${player.name} - Villages - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        player,
        villages,
        navigation: [
            `<a href="/">Stats</a>`,
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

const playerConquestsRouter = asyncRouter(async function (req, res, next) {
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
        player = await db.one(sql.getPlayer, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let conquests
    let total
    let navigationTitle = ['Conquests']

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

    switch (req.params.type) {
        case undefined: {
            conquests = await db.any(sql.getPlayerConquests, {worldId, playerId, offset, limit})
            total = (await db.one(sql.getPlayerConquestsCount, {worldId, playerId})).count
            break
        }
        case conquestTypes.GAIN: {
            conquests = await db.any(sql.getPlayerConquestsGain, {worldId, playerId, offset, limit})
            total = (await db.one(sql.getPlayerConquestsGainCount, {worldId, playerId})).count
            navigationTitle.push('Gains')
            break
        }
        case conquestTypes.LOSS: {
            conquests = await db.any(sql.getPlayerConquestsLoss, {worldId, playerId, offset, limit})
            total = (await db.one(sql.getPlayerConquestsLossCount, {worldId, playerId})).count
            navigationTitle.push('Losses')
            break
        }
        default: {
            throw createError(404, 'This conquests sub page does not exist')
        }
    }

    conquests = conquests.map(function (conquest) {
        if (conquest.new_owner === conquest.old_owner) {
            conquest.type = conquestTypes.SELF
        } else if (conquest.new_owner === playerId) {
            conquest.type = conquestTypes.GAIN
        } else if (conquest.old_owner === playerId) {
            conquest.type = conquestTypes.LOSS
        }

        return conquest
    })

    navigationTitle = navigationTitle.join(' ')

    res.render('stats/player-conquests', {
        title: `Player ${player.name} - Conquests - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        conquests,
        conquestTypes,
        navigationTitle,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${world.num}/players/${player.id}">${player.name}</a>`,
            navigationTitle
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
})

router.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/:type?', playerConquestsRouter)
router.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/:type?/page/:page', playerConquestsRouter)

router.get('/stats/:marketId/:worldNumber/players/:character_id/tribe-changes', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const playerId = parseInt(req.params.character_id, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    let player

    try {
        player = await db.one(sql.getPlayer, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    const tribeChanges = await db.any(sql.getPlayerTribeChanges, {worldId, id: playerId})
    const tribeTags = {}

    for (let change of tribeChanges) {
        if (change.old_tribe && !hasOwn.call(tribeTags, change.old_tribe)) {
            tribeTags[change.old_tribe] = (await db.one(sql.getTribe, {worldId, tribeId: change.old_tribe})).tag
        }

        if (change.new_tribe && !hasOwn.call(tribeTags, change.new_tribe)) {
            tribeTags[change.new_tribe] = (await db.one(sql.getTribe, {worldId, tribeId: change.new_tribe})).tag
        }
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/player-tribe-changes', {
        title: `Player ${player.name} - Tribe Changes - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        player,
        tribeChanges,
        changeIndex: tribeChanges.length,
        tribeTags,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${world.num}/players/${player.id}">${player.name}</a>`,
            'Tribe Changes'
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

router.get('/stats/:marketId/:worldNumber/players/:character_id/achievements/:category?/:sub_category?', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const achievementCategoryTitles = {
        overall: 'Overall',
        battle: 'Battle',
        points: 'Points',
        tribe: 'Tribe',
        repeatable: 'Daily / Weekly',
        special: 'Special',
        friends: 'Friends',
        milestone: 'Milestone',
        ruler: 'Ruler'
    }
    const achievementCategories = ['battle', 'points', 'tribe', 'repeatable', 'special', 'friends', 'milestone', 'ruler']
    const achievementCategoriesUnique = ['battle', 'points', 'tribe', 'special', 'friends', 'milestone', 'ruler']

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const playerId = parseInt(req.params.character_id, 10)
    const selectedCategory = req.params.category
    const subCategory = req.params.sub_category

    if (selectedCategory && !achievementCategories.includes(selectedCategory)) {
        throw createError(404, 'This achievement category does not exist')
    }

    if (selectedCategory === 'repeatable') {
        if (!(subCategory === 'detailed' || !subCategory)) {
            throw createError(404, 'This achievement sub-category does not exist')
        }
    } else if (subCategory) {
        throw createError(404, 'This achievement sub-category does not exist')
    }

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    let player

    try {
        player = await db.one(sql.getPlayer, {worldId, playerId})
    } catch (error) {
        throw createError(404, 'This player does not exist')
    }

    const achievementTypes = Object.fromEntries(await db.map(sql.achievementTypes, {}, (achievement) => [achievement.name, achievement]))
    const achievements = await db.any(sql.getPlayerAchievements, {worldId, id: playerId})
    const achievementByCategory = {}
    const achievementsWithPoints = []

    for (let category of achievementCategories) {
        achievementByCategory[category] = []
    }

    for (let achievement of achievements) {
        if (achievement.category !== 'repeatable') {
            const typeData = achievementTypes[achievement.type]

            achievement.points = typeData.milestone
                ? typeData.points[achievement.level - 1]
                : typeData.points.slice(0, achievement.level).reduce((sum, next) => sum + next, 0)
        }

        achievementsWithPoints.push(achievement)
        achievementByCategory[achievement.category].push(achievement)
    }

    const achievementsNonRepeatable = achievementsWithPoints.filter(function (achievement) {
        return achievement.category !== 'repeatable'
    })

    const achievementsRepeatable = achievementsWithPoints.filter(function (achievement) {
        return achievement.category === 'repeatable'
    })

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let categoryTemplate
    let navigationTitle
    let overviewData
    const achievementsRepeatableCount = {}
    const achievementsRepeatableLastEarned = {}
    const achievementsRepeatableDetailed = {}

    if (!selectedCategory) {
        categoryTemplate = 'overview'
        navigationTitle = achievementCategoryTitles[selectedCategory] + ' Achievements'
        overviewData = getAchievementsOverview(achievementCategoriesUnique, achievementTypes, achievementByCategory)
    } else if (selectedCategory === 'repeatable') {
        categoryTemplate = 'repeatable'
        navigationTitle = achievementCategoryTitles[selectedCategory] + ' Achievements'

        for (let {type, time_last_level} of achievementsRepeatable) {
            if (!achievementsRepeatableLastEarned[type]) {
                achievementsRepeatableLastEarned[type] = utils.ejsHelpers.formatDate(time_last_level, 'day-only')
            }

            if (subCategory === 'detailed') {
                achievementsRepeatableDetailed[type] = achievementsRepeatableDetailed[type] || []
                achievementsRepeatableDetailed[type].push(utils.ejsHelpers.formatDate(time_last_level, 'day-only'))
            }

            achievementsRepeatableCount[type] = achievementsRepeatableCount[type] ?? 0
            achievementsRepeatableCount[type]++
        }
    } else {
        categoryTemplate = 'generic'
        navigationTitle = achievementCategoryTitles[selectedCategory] + ' Achievements'
    }

    res.render('stats/player-achievements', {
        title: `Player ${player.name} - Achievements - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        player,
        selectedCategory,
        subCategory,
        categoryTemplate,
        overviewData,
        achievements,
        achievementByCategory,
        achievementsWithPoints,
        achievementsNonRepeatable,
        achievementsRepeatable,
        achievementsRepeatableLastEarned,
        achievementsRepeatableCount,
        achievementsRepeatableDetailed,
        achievementCategoryTitles,
        achievementTitles,
        achievementTypes,
        navigationTitle,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${world.num}/players/${player.id}">${player.name}</a>`,
            'Achievements'
        ],
        exportValues: {
            marketId,
            worldNumber,
            player
        },
        ...utils.ejsHelpers
    })
}))

router.get('/stats/:marketId/:worldNumber/villages/:village_id', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const village_id = parseInt(req.params.village_id, 10)

    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    let village

    try {
        village = await db.one(sql.getVillage, {worldId, village_id})
    } catch (error) {
        throw createError(404, 'This village does not exist')
    }

    const conquests = await db.any(sql.getVillageConquests, {worldId, village_id})
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    res.render('stats/village', {
        title: `Village ${village.name} (${village.x}|${village.y}) - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        village,
        conquests,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${world.num}/">${world.name}</a>`,
            `Village <a href="/stats/${marketId}/${world.num}/villages/${village.id}">${village.name}</a>`
        ],
        exportValues: {
            marketId,
            worldNumber,
            village,
            mapHighlights: [village],
            mapHighlightsType: 'villages'
        },
        ...utils.ejsHelpers
    })
}))

router.post('/stats/:marketId/:worldNumber/search/', asyncRouter(async function (req, res, next) {
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

    return res.redirect(303, `/stats/${marketId}/${worldNumber}/search/${category}/${rawQuery}`)
}))

router.get('/stats/:marketId/:worldNumber/search/', asyncRouter(async function (req, res, next) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const worldExists = await utils.schemaExists(worldId)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    return res.redirect(302, `/stats/${marketId}/${worldNumber}`)
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

    const world = await db.one(sql.getWorld, [marketId, worldNumber])
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
    const allResults = await db.any(sql.search[category], {worldId, query})
    const results = allResults.slice(offset, offset + limit)
    const total = allResults.length

    return res.render('stats/search', {
        title: `Search "${rawQuery}" - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        world,
        category,
        results,
        resultsCount: results.length,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
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

router.get('/stats/:marketId/:worldNumber/search/:category/:query', asyncRouter(routerSearch))
router.get('/stats/:marketId/:worldNumber/search/:category/:query/page/:page', asyncRouter(routerSearch))

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

    const world = await db.one(sql.getWorld, [marketId, worldNumber])
    const limit = settings.ranking_items_per_page

    let players
    let tribes
    let total

    switch (category) {
        case RANKING_CATEGORIES.players: {
            players = await db.any(sql.getWorldRankingPlayers, {worldId, offset, limit})
            total = await db.one(sql.getWorldPlayerCount, {worldId})
            total = parseInt(total.count, 10)
            break
        }
        case RANKING_CATEGORIES.tribes: {
            tribes = await db.any(sql.getWorldRankingTribes, {worldId, offset, limit})
            total = await db.one(sql.getWorldTribeCount, {worldId})
            total = parseInt(total.count, 10)
            break
        }
    }

    const capitalizedCategory = utils.capitalize(category)

    res.render('stats/ranking', {
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
            `<a href="/">Stats</a>`,
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

router.get('/stats/:marketId/:worldNumber/ranking/:category?/', asyncRouter(routerRanking))
router.get('/stats/:marketId/:worldNumber/ranking/:category?/page/:page', asyncRouter(routerRanking))

function getAchievementsOverview (achievementCategoriesUnique, achievementTypes, achievementByCategory) {
    const overviewData = []
    const categoriesMaxPoints = {}

    for (let category of achievementCategoriesUnique) {
        categoriesMaxPoints[category] = 0
    }

    for (let achievement of Object.values(achievementTypes)) {
        if (!achievement.repeatable) {
            categoriesMaxPoints[achievement.category] += achievement.milestone
                ? achievement.points[achievement.points.length - 1]
                : achievement.points.reduce((sum, next) => sum + next, 0)
        }
    }

    const achievementsMaxPoints = Object.values(categoriesMaxPoints).reduce((sum, next) => sum + next, 0)

    overviewData.push(...achievementCategoriesUnique.map(function (category) {
        const max = categoriesMaxPoints[category]
        const current = achievementByCategory[category].reduce((sum, next) => sum + next.points, 0)
        const percent = Math.floor(current / max * 100)

        return [category, {
            max,
            current,
            percent
        }]
    }))

    const overallCurrent = overviewData.reduce((sum, [, next]) => sum + next.current, 0)
    const overallMax = achievementsMaxPoints
    const overallPercent = Math.floor(overallCurrent / overallMax * 100)

    overviewData.unshift(['overall', {
        max: overallMax,
        current: overallCurrent,
        percent: overallPercent
    }])

    return overviewData
}

module.exports = router
