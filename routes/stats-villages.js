const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const {db} = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')

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

module.exports = router
