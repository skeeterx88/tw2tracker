const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const {db} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')

const {
    paramWorld,
    paramWorldParse
} = require('../router-helpers.js')

const rankingCategories = ['players', 'tribes']

const rankingRouterSqlMap = {
    players: {
        ranking: sql.getWorldRankingPlayers,
        count: sql.getWorldPlayerCount
    },
    tribes: {
        ranking: sql.getWorldRankingTribes,
        count: sql.getWorldTribeCount
    }
}

const rankingCategoryRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const category = req.params.category

    if (!rankingCategories.includes(category)) {
        throw createError(404, 'This ranking category does not exist')
    }

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

    const ranking = await db.any(rankingRouterSqlMap[category].ranking, {worldId, offset, limit})
    const {count} = await db.one(rankingRouterSqlMap[category].count, {worldId})
    const total = parseInt(count, 10)
    const capitalizedCategory = utils.capitalize(category)

    res.render('stats/ranking', {
        title: `${capitalizedCategory} Ranking - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: world.name,
        world,
        ranking,
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
})

router.get('/stats/:marketId/:worldNumber/ranking/:category?/', rankingCategoryRouter)
router.get('/stats/:marketId/:worldNumber/ranking/:category?/page/:page', rankingCategoryRouter)

module.exports = router
