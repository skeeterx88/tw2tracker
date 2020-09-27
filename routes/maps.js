const fs = require('fs')
const path = require('path')
const express = require('express')
const router = express.Router()

const db = require('../db')
const sql = require('../sql')
const Sync = require('../sync')

const checkWorldSchemaExists = async function (marketId, worldNumber) {
    const worldSchema = await db.one(sql.schemaExists, [marketId + worldNumber])
    return worldSchema.exists
}

router.get('/', async function (req, res) {
    const settings = await db.one(sql.settings)
    const worlds = await db.any(sql.worlds)
    const markets = await db.any(sql.markets)

    res.render('maps', {
        title: 'All Available Maps - ' + settings.site_name,
        worlds: worlds,
        markets: markets
    })
})

router.get('/:marketId/:worldNumber', async function (req, res) {
    const settings = await db.one(sql.settings)
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const worldInfo = await db.one(sql.world, [marketId, worldNumber])
    const lastSync = worldInfo.last_sync ? new Date(worldInfo.last_sync).getTime() : false

    res.render('map', {
        title: 'Map ' + worldId + ' - ' + settings.site_name,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        lastSync,
        development: process.env.NODE_ENV === 'development'
    })
})

router.get('/api/:marketId/:worldNumber/players', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    fs.promises.readFile(path.join('.', 'data', worldId, 'players.json'))
    .then(function (data) {
        res.setHeader('Content-Type', 'application/json')
        res.end(data)
    })
    .catch(function () {
        res.status(404)
        res.send('Invalid API call')
    })
})

router.get('/api/:marketId/:worldNumber/tribes', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    fs.promises.readFile(path.join('.', 'data', worldId, 'tribes.json'))
    .then(function (data) {
        res.setHeader('Content-Type', 'application/json')
        res.end(data)
    })
    .catch(function () {
        res.status(404)
        res.send('Invalid API call')
    })
})


router.get('/api/:marketId/:worldNumber/continent/:continentId', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const continentId = parseInt(req.params.continentId, 10)

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    if (continentId < 0 || continentId > 99) {
        res.status(400)
        res.send('Invalid API call')
        return false
    }

    res.setHeader('Content-Type', 'application/json')

    fs.promises.readFile(path.join('.', 'data', worldId, continentId + '.json'))
    .then(function (data) {
        res.end(data)
    })
    .catch(function () {
        res.end('{}')
    })
})

module.exports = router
