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
    paramPlayerParse,
    getTribe,
    getPlayerVillages
} = require('../router-helpers.js')

const conquestTypes =  {
    GAIN: 'gain',
    LOSS: 'loss',
    SELF: 'self'
}

router.get('/stats/:marketId/:worldNumber/players/:playerId', asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId)


    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let conquestCount = await db.one(sql.getPlayerConquestCount, {worldId, playerId})
    conquestCount[conquestTypes.GAIN] = parseInt(conquestCount[conquestTypes.GAIN], 10)
    conquestCount[conquestTypes.LOSS] = parseInt(conquestCount[conquestTypes.LOSS], 10)

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
    const tribe = player.tribe_id ? await getTribe(worldId, player.tribe_id) : false

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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${worldNumber}/players/${player.id}">${player.name}</a>`
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

router.get('/stats/:marketId/:worldNumber/players/:playerId/villages', asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId)

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])
    const villages = await getPlayerVillages(worldId, playerId)

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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${worldNumber}/players/${player.id}">${player.name}</a>`,
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
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId)

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    let conquests
    let total
    let navigationTitle = ['Conquests']

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

    // TODO: use sql mapping
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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${worldNumber}/players/${player.id}">${player.name}</a>`,
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

router.get('/stats/:marketId/:worldNumber/players/:playerId/tribe-changes', asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId)

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

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

    res.render('stats/player-tribe-changes', {
        title: `Player ${player.name} - Tribe Changes - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        player,
        tribeChanges,
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

router.get('/stats/:marketId/:worldNumber/players/:playerId/achievements/:category?/:sub_category?', asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId)

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const selectedCategory = req.params.category
    const subCategory = req.params.sub_category

    const achievementCategories = ['battle', 'points', 'tribe', 'repeatable', 'special', 'friends', 'milestone', 'ruler']
    const achievementCategoriesUnique = ['battle', 'points', 'tribe', 'special', 'friends', 'milestone', 'ruler']

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
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Player <a href="/stats/${marketId}/${worldNumber}/players/${player.id}">${player.name}</a>`,
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
