const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const {db} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter, hasOwn} = utils
const getSettings = require('../settings')
const achievementTitles = require('../achievement-titles.json')

const {
    paramWorld,
    paramWorldParse,
    paramTribeParse
} = require('../router-helpers.js')

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

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const conquestCount = await db.one(sql.getTribeConquestsCount, {worldId, tribeId})
    conquestCount[conquestTypes.GAIN] = parseInt(conquestCount[conquestTypes.GAIN], 10)
    conquestCount[conquestTypes.LOSS] = parseInt(conquestCount[conquestTypes.LOSS], 10)

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribeId})
    const achievementsLatest = achievements.slice(0, 5)
    const achievementsRepeatableCount = achievements.reduce((sum, {period}) => period ? sum + 1 : sum, 0)

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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`
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

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let conquests
    let total
    let navigationTitle = ['Conquests']

    // TODO: create helper to create pagination
    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

    // TODO: use sql mapping
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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
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

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])
    const members = await db.any(sql.getTribeMembers, {worldId, tribeId})

    res.render('stats/tribe-members', {
        title: `Tribe ${tribe.tag} - Members - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
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

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1
    const limit = settings.ranking_items_per_page
    const offset = limit * (page - 1)
    const allVillages = await db.any(sql.getTribeVillages, {worldId, tribeId})
    const villages = allVillages.slice(offset, offset + limit)
    const total = allVillages.length

    res.render('stats/tribe-villages', {
        title: `Tribe ${tribe.tag} - Villages - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        tribe,
        villages,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
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

    const settings = await getSettings()
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
        title: `Tribe ${tribe.tag} - Member Changes - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        tribe,
        memberChanges,
        tribeMemberChangeTypes,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
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

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const subCategory = req.params.subCategory

    if (subCategory && subCategory !== 'detailed') {
        throw createError(404, 'This achievement sub-category does not exist')
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

    res.render('stats/tribe-achievements', {
        title: `Tribe ${tribe.tag} - Achievements - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Tribe <a href="/stats/${marketId}/${worldNumber}/tribes/${tribeId}">${tribe.tag}</a>`,
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
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/achievements/:subCategory?', tribeAchievementsRouter)

module.exports = router
