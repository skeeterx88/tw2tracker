const express = require('express')
const router = express.Router()
const db = require('../db.js')
const sql = require('../sql.js')
const utils = require('../utils.js')
const {asyncRouter} = utils
const config = require('../config.js')

const {
    paramWorld,
    paramWorldParse,
    paramVillageParse
} = require('../router-helpers.js')

const villageRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next()
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const {
        villageId,
        village
    } = await paramVillageParse(req, worldId)

    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const conquests = await db.any(sql.getVillageConquests, {worldId, villageId})

    res.render('stats/village', {
        title: `Village ${village.name} (${village.x}|${village.y}) - ${marketId.toUpperCase()}/${world.name} - ${config.site_name}`,
        marketId,
        worldNumber,
        world,
        village,
        conquests,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Village <a href="/stats/${marketId}/${worldNumber}/villages/${village.id}">${village.name}</a>`
        ],
        backendValues: {
            marketId,
            worldNumber,
            village,
            mapHighlights: [village],
            mapHighlightsType: 'villages'
        },
        ...utils.ejsHelpers
    })
})

router.get('/stats/:marketId/:worldNumber/villages/:villageId', villageRouter)

module.exports = router
