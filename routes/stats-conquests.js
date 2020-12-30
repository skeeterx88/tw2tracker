const express = require('express')
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

const conquestsRouter = asyncRouter(async function (req, res, next) {
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

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1
    const offset = settings.ranking_items_per_page * (page - 1)
    const limit = settings.ranking_items_per_page

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

module.exports = router
