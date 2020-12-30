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

const searchCategories = ['players', 'tribes', 'villages']

const searchPostRedirectRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldNumber
    } = await paramWorldParse(req)

    const rawQuery = encodeURIComponent(req.body.query)
    const category = (req.body.category || '').toLowerCase()

    if (!searchCategories.includes(category)) {
        throw createError(404, 'This search category does not exist')
    }

    return res.redirect(303, `/stats/${marketId}/${worldNumber}/search/${category}/${rawQuery}`)
})

const searchGetRedirectRouter = asyncRouter(async function (req, res, next) {
    const {
        marketId,
        worldNumber
    } = await paramWorldParse(req)

    return res.redirect(302, `/stats/${marketId}/${worldNumber}`)
})

const categorySearchRouter = asyncRouter(async function (req, res, next) {
    const category = req.params.category

    if (!searchCategories.includes(category)) {
        return next()
    }

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

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1
    const limit = settings.ranking_items_per_page
    const offset = limit * (page - 1)

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
        category,
        results,
        resultsCount: results.length,
        pagination: utils.createPagination(page, total, limit, req.path),
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Search "${rawQuery}"`
        ],
        exportValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    })
})

router.post('/stats/:marketId/:worldNumber/search/', searchPostRedirectRouter)
router.get('/stats/:marketId/:worldNumber/search/', searchGetRedirectRouter)
router.get('/stats/:marketId/:worldNumber/search/:category/:query', categorySearchRouter)
router.get('/stats/:marketId/:worldNumber/search/:category/:query/page/:page', categorySearchRouter)

module.exports = router
