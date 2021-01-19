const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const db = require('../db.js')
const sql = require('../sql.js')
const utils = require('../utils.js')
const {asyncRouter, hasOwn} = utils
const config = require('../config.js')
const achievementTitles = require('../achievement-titles.json')

const {
    paramWorld,
    paramWorldParse,
    paramTribeParse,
    createPagination
} = require('../router-helpers.js')

const conquestTypes =  {
    GAIN: 'gain',
    LOSS: 'loss',
    SELF: 'self'
}

const conquestCategories = ['gain', 'loss', 'all']

const tribeMemberChangeTypes = {
    LEFT: 'left',
    JOIN: 'join'
}

const tribeRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const conquestGainCount = (await db.one(sql.getTribeConquestsGainCount, {worldId, tribeId})).count
    const conquestLossCount = (await db.one(sql.getTribeConquestsLossCount, {worldId, tribeId})).count

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribeId})
    const achievementsLatest = achievements.slice(0, 5)
    const achievementsRepeatableCount = achievements.reduce((sum, {period}) => period ? sum + 1 : sum, 0)

    const memberChangesCount = (await db.one(sql.getTribeMemberChangesCount, {worldId, id: tribeId})).count

    res.render('stats/tribe', {
        title: `Tribe ${tribe.tag} - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        conquestGainCount,
        conquestLossCount,
        conquestTypes,
        achievementsRepeatableCount,
        achievementTitles,
        achievementsLatest,
        memberChangesCount,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`
        ],
        backendValues: {
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
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1
    const limit = parseInt(config.ranking_items_per_page, 10)
    const offset = limit * (page - 1)

    const conquestsTypeMap = {
        all: {
            sqlConquests: sql.getTribeConquests,
            sqlCount: sql.getTribeConquestsCount,
            navigationTitle: 'Conquests'
        },
        gain: {
            sqlConquests: sql.getTribeConquestsGain,
            sqlCount: sql.getTribeConquestsGainCount,
            navigationTitle: 'Conquest Gains'
        },
        loss: {
            sqlConquests: sql.getTribeConquestsLoss,
            sqlCount: sql.getTribeConquestsLossCount,
            navigationTitle: 'Conquest Losses'
        }
    }

    const category = req.params.category ?? 'all'

    if (!conquestCategories.includes(category)) {
        throw createError(404, 'This conquests sub page does not exist')
    }

    const conquests = await db.map(conquestsTypeMap[category].sqlConquests, {worldId, tribeId, offset, limit}, function (conquest) {
        if (conquest.new_owner_tribe_id === conquest.old_owner_tribe_id) {
            conquest.type = conquestTypes.SELF
        } else if (conquest.new_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.GAIN
        } else if (conquest.old_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.LOSS
        }

        return conquest
    })

    const total = (await db.one(conquestsTypeMap[category].sqlCount, {worldId, tribeId})).count
    const navigationTitle = conquestsTypeMap[category].navigationTitle

    res.render('stats/tribe-conquests', {
        title: `Tribe ${tribe.tag} - Conquests - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        world,
        tribe,
        conquests,
        conquestTypes,
        category,
        navigationTitle,
        pagination: createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
            navigationTitle
        ],
        backendValues: {
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
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])
    const members = await db.any(sql.getTribeMembers, {worldId, tribeId})

    res.render('stats/tribe-members', {
        title: `Tribe ${tribe.tag} - Members - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        tribe,
        members,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
            `Members`
        ],
        backendValues: {
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
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1
    const limit = parseInt(config.ranking_items_per_page, 10)
    const offset = limit * (page - 1)
    const allVillages = await db.any(sql.getTribeVillages, {worldId, tribeId})
    const villages = allVillages.slice(offset, offset + limit)
    const total = allVillages.length

    res.render('stats/tribe-villages', {
        title: `Tribe ${tribe.tag} - Villages - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        tribe,
        villages,
        pagination: createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
            `Villages`
        ],
        backendValues: {
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
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

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

    res.render('stats/tribe-member-changes', {
        title: `Tribe ${tribe.tag} - Member Changes - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        tribe,
        world,
        memberChanges,
        tribeMemberChangeTypes,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
            `Member Changes`
        ],
        backendValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
})

const tribeAchievementsRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const subCategory = req.params.subCategory

    if (subCategory && subCategory !== 'detailed') {
        throw createError(404, 'This achievement sub-category does not exist')
    }

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribeId})
    const achievementsRepeatable = {}
    const achievementsRepeatableCategoryCount = {}
    let achievementsRepeatableGeralCount = 0
    const achievementsRepeatableLastEarned = {}
    const achievementsRepeatableDetailed = {}

    for (let {period, type, time_last_level} of achievements) {
        if (period) {
            if (!achievementsRepeatableLastEarned[type]) {
                achievementsRepeatableLastEarned[type] = utils.ejsHelpers.formatDate(time_last_level, world.time_offset, 'day-only')
            }

            achievementsRepeatable[type] = achievementsRepeatable[type] || []
            achievementsRepeatable[type].push(utils.ejsHelpers.formatDate(time_last_level, world.time_offset, 'day-only'))

            achievementsRepeatableCategoryCount[type] = achievementsRepeatableCategoryCount[type] ?? 0
            achievementsRepeatableCategoryCount[type]++
            achievementsRepeatableGeralCount++

            if (subCategory === 'detailed') {
                achievementsRepeatableDetailed[type] = achievementsRepeatableDetailed[type] || []
                achievementsRepeatableDetailed[type].push(utils.ejsHelpers.formatDate(time_last_level, world.time_offset, 'day-only'))
            }
        }
    }

    res.render('stats/tribe-achievements', {
        title: `Tribe ${tribe.tag} - Achievements - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        tribe,
        achievementsRepeatable,
        achievementsRepeatableCategoryCount,
        achievementsRepeatableGeralCount,
        achievementsRepeatableLastEarned,
        achievementsRepeatableDetailed,
        subCategory,
        achievementTitles,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
            'Achievements'
        ],
        backendValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
})

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId', tribeRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:category?', tribeConquestsRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:category?/page/:page', tribeConquestsRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/members', tribeMembersRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages', tribeVillagesRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages/page/:page', tribeVillagesRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/member-changes', tribeMembersChangeRouter)
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/achievements/:subCategory?', tribeAchievementsRouter)

module.exports = router
