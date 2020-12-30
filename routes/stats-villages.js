const express = require('express')
const router = express.Router()
const {db} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')

const {
    paramWorld,
    paramWorldParse,
    paramVillageParse
} = require('../router-helpers.js')

router.get('/stats/:marketId/:worldNumber/villages/:villageId', asyncRouter(async function (req, res, next) {
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

    const settings = await getSettings()
    const world = await db.one(sql.getWorld, [marketId, worldNumber])

    const conquests = await db.any(sql.getVillageConquests, {worldId, villageId})

    res.render('stats/village', {
        title: `Village ${village.name} (${village.x}|${village.y}) - ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        worldNumber,
        village,
        conquests,
        navigation: [
            `<a href="/">Stats</a>`,
            `Server <a href="/stats/${marketId}/">${marketId.toUpperCase()}</a>`,
            `World <a href="/stats/${marketId}/${worldNumber}/">${world.name}</a>`,
            `Village <a href="/stats/${marketId}/${worldNumber}/villages/${village.id}">${village.name}</a>`
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

module.exports = router
