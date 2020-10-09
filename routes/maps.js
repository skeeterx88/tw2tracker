const fs = require('fs')
const path = require('path')
const express = require('express')
const router = express.Router()
const utils = require('../utils')
const zlib = require('zlib')
const EMPTY_CONTINENT = zlib.gzipSync('{}')

const db = require('../db')
const sql = require('../sql')
const Sync = require('../sync')

const MAP_SHARE_TYPES = {
    static: 'static',
    dynamic: 'dynamic'
}

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
    const allWorlds = await db.any(sql.openWorlds)
    const allMarkets = await db.map(sql.enabledMarkets, [], market => market.id)

    res.render('map', {
        title: 'Map ' + worldId + ' - ' + settings.site_name,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        lastSync,
        mapShareId: '',
        mapShareType: '',
        mapShareCreationDate: '',
        allWorlds: JSON.stringify(allWorlds),
        allMarkets: JSON.stringify(allMarkets),
        development: process.env.NODE_ENV === 'development'
    })
})

router.get('/:marketId/:worldNumber/share/:mapShareId', async function (req, res) {
    const settings = await db.one(sql.settings)
    const mapShareId = req.params.mapShareId
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const allWorlds = await db.any(sql.openWorlds)
    const allMarkets = await db.map(sql.enabledMarkets, [], market => market.id)

    let worldInfo
    let mapShare

    try {
        worldInfo = await db.one(sql.world, [marketId, worldNumber])
    } catch (error) {
        res.status(404)
        res.send('World does not exist')
        return false
    }

    try {
        mapShare = await db.one(sql.getMapShare, [mapShareId, marketId, worldNumber])
    } catch (error) {
        res.status(404)
        res.send('Map share does not exist')
        return false
    }

    const worldId = marketId + worldNumber
    const lastSync = worldInfo.last_sync ? new Date(worldInfo.last_sync).getTime() : false
    const mapShareType = mapShare ? mapShare.type : ''
    const mapShareCreationDate = mapShare ? new Date(mapShare.creation_date).getTime() : '0'

    res.render('map', {
        title: 'Map ' + worldId + ' - ' + settings.site_name,
        marketId,
        worldNumber,
        worldName: worldInfo.name,
        lastSync,
        mapShareId,
        mapShareType,
        mapShareCreationDate,
        allWorlds: JSON.stringify(allWorlds),
        allMarkets: JSON.stringify(allMarkets),
        development: process.env.NODE_ENV === 'development'
    })
})

router.get('/api/:marketId/:worldNumber/players/:mapShareId?', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const mapShareId = req.params.mapShareId
    const worldId = marketId + worldNumber

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    let dataPath

    if (mapShareId) {
        const mapShare = await db.one(sql.getMapShare, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, 'players')
    } else {
        dataPath = path.join('.', 'data', worldId, 'players')
    }

    fs.promises.readFile(dataPath)
    .then(function (data) {
        res.setHeader('Content-Encoding', 'zlib')
        res.end(data)
    })
    .catch(function () {
        res.status(404)
        res.send('Invalid API call')
    })
})

router.get('/api/:marketId/:worldNumber/tribes/:mapShareId?', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const mapShareId = req.params.mapShareId
    const worldId = marketId + worldNumber

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    let dataPath

    if (mapShareId) {
        const mapShare = await db.one(sql.getMapShare, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, 'tribes')
    } else {
        dataPath = path.join('.', 'data', worldId, 'tribes')
    }

    fs.promises.readFile(dataPath)
    .then(function (data) {
        res.setHeader('Content-Encoding', 'zlib')
        res.end(data)
    })
    .catch(function () {
        res.status(404)
        res.send('Invalid API call')
    })
})


router.get('/api/:marketId/:worldNumber/continent/:continentId/:mapShareId?', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const continentId = req.params.continentId
    const mapShareId = req.params.mapShareId

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    if (continentId < 0 || continentId > 99 || isNaN(continentId)) {
        res.status(400)
        res.send('Invalid API call')
        return false
    }

    let dataPath

    if (mapShareId) {
        const mapShare = await db.one(sql.getMapShare, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, continentId)
    } else {
        dataPath = path.join('.', 'data', worldId, continentId)
    }

    fs.promises.readFile(dataPath)
    .then(function (data) {
        res.setHeader('Content-Encoding', 'zlib')
        res.end(data)
    })
    .catch(function () {
        res.setHeader('Content-Encoding', 'zlib')
        res.end(EMPTY_CONTINENT)
    })
})

router.get('/api/:marketId/:worldNumber/struct', async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    
    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.send('Invalid API call')
        return false
    }

    fs.promises.readFile(path.join('.', 'data', worldId, 'struct'))
    .then(function (data) {
        res.setHeader('Content-Encoding', 'zlib')
        res.end(data)
    })
    .catch(function () {
        res.status(400)
        res.send('API call error')
    })
})

router.post('/api/create-share', async function (req, res) {
    const response = {}
    const {
        marketId,
        worldNumber,
        highlights,
        type,
        settings,
        center
    } = req.body

    try {
        const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

        if (!worldExists) {
            throw new Error('World does not exist')
        }

        if (!MAP_SHARE_TYPES.hasOwnProperty(type)) {
            throw new Error('Invalid share type')
        }

        if (!highlights || !Array.isArray(highlights)) {
            throw new Error('Invalid highlights data')
        }

        if (!highlights.length) {
            throw new Error('No highlights specified')
        }

        const highlightsString = JSON.stringify(highlights)
        const shareId = utils.makeid(20)

        const settingsString = JSON.stringify(settings)
        const mapShare = await db.one(sql.addMapShare, [shareId, marketId, worldNumber, type, highlightsString, settingsString, center.x, center.y])

        if (type === MAP_SHARE_TYPES.static) {
            const dateId = utils.getHourlyDir(mapShare.creation_date)
            const worldId = marketId + worldNumber
            const copyDestination = path.join('.', 'data', 'static-maps', worldId, dateId)

            try {
                await fs.promises.access(copyDestination)
            } catch {
                const worldDataLocation = path.join('.', 'data', worldId)
                const worldData = await fs.promises.readdir(worldDataLocation)
                const toCopy = worldData.filter((file) => file !== 'struct')

                await fs.promises.mkdir(copyDestination, { recursive: true })

                for (let file of toCopy) {
                    await fs.promises.copyFile(
                        path.join(worldDataLocation, file),
                        path.join(copyDestination, file)
                    )
                }
            }
        }

        response.success = true
        response.url = `/maps/${marketId}/${worldNumber}/share/${shareId}`
    } catch (error) {
        response.success = false
        response.message = error.message
    }

    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(response))
})

router.post('/api/get-share', async function (req, res) {
    const response = {}

    let {
        mapShareId,
        marketId,
        worldNumber
    } = req.body

    let worldInfo
    let mapShare

    res.setHeader('Content-Type', 'application/json')

    try {
        worldInfo = await db.one(sql.world, [marketId, worldNumber])
    } catch (error) {
        response.success = false
        response.message = 'World does not exist'
        return res.end(JSON.stringify(response))
    }

    try {
        mapShare = await db.one(sql.getMapShare, [mapShareId, marketId, worldNumber])
    } catch (error) {
        response.success = false
        response.message = 'Map share does not exist'
        return res.end(JSON.stringify(response))
    }

    response.success = true
    response.data = mapShare

    res.end(JSON.stringify(response))
})

module.exports = router
