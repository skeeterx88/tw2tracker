const express = require('express')
const router = express.Router()
const db = require('../db')
const sql = require('../sql')
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')

router.get('/:marketId/:worldNumber', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    const worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])
    const worldId = marketId + worldNumber

    const players = await db.any('SELECT * FROM ${schema:name}.players ORDER BY points DESC LIMIT 10', {
        schema: worldId
    })

    const tribes = await db.any('SELECT * FROM ${schema:name}.tribes ORDER BY points DESC LIMIT 10', {
        schema: worldId
    })

    res.render('stats', {
        title: `Stats ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        players,
        tribes,
        siteName: settings.site_name,
        development: process.env.NODE_ENV === 'development',
        exportValues: {
            marketId,
            worldNumber,
            players,
            tribes
        }
    })
}))

router.get('/:marketId/:worldNumber/tribes/:tribeId', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const tribeId = parseInt(req.params.tribeId, 10)

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        res.status(404)
        throw new Error('This world does not exist')
    }

    let tribe

    try {
        tribe = await db.one(sql.worlds.tribe, {
            schema: marketId + worldNumber,
            tribeId
        })
    } catch (error) {
        res.status(404)
        throw new Error('This tribe does not exist')
    }

    const worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])
    const worldId = marketId + worldNumber

    res.render('stats-tribe', {
        title: `Tribe ${tribe.name} - ${marketId}${worldNumber} - ${settings.site_name}`,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        tribe,
        siteName: settings.site_name,
        development: process.env.NODE_ENV === 'development'
    })
}))

module.exports = router
