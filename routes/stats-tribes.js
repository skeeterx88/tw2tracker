const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const {db} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter, hasOwn} = utils
const getSettings = require('../settings')
const achievementTitles = require('../achievement-titles.json')

const conquestTypes =  {
    GAIN: 'gain',
    LOSS: 'loss',
    SELF: 'self'
}

const tribeMemberChangeTypes = {
    LEFT: 'left',
    JOIN: 'join'
}

const tribeRouter = asyncRouter(async function (req, res, next) {
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
})

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

const tribeMembersRouter = asyncRouter(async function (req, res, next) {
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
})

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

const tribeMembersChangeRouter = asyncRouter(async function (req, res, next) {
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
})

const tribeAchievementsRouter = asyncRouter(async function (req, res, next) {
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
})

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId', tribeRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:type?', tribeConquestsRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:type?/page/:page', tribeConquestsRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/members', tribeMembersRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages', tribeVillagesRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages/page/:page', tribeVillagesRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/member-changes', tribeMembersChangeRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/achievements/:sub_category?', tribeAchievementsRouter)

module.exports = router
