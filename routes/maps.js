const fs = require('fs')
const path = require('path')
const express = require('express')
const router = express.Router()
const utils = require('../utils')
const getSettings = require('../settings')
const EMPTY_CONTINENT = Buffer.from([31,139,8,0,0,0,0,0,0,3,171,174,5,0,67,191,166,163,2,0,0,0])

const db = require('../db')
const sql = require('../sql')

const mapShareTypes = {
    STATIC: 'static',
    DYNAMIC: 'dynamic'
}

const checkWorldSchemaExists = async function (marketId, worldNumber) {
    const worldSchema = await db.one(sql.helpers.schemaExists, [marketId + worldNumber])
    return worldSchema.exists
}

router.get('/', async function (req, res) {
    const [
        settings,
        worlds,
        markets
    ] = await Promise.all([
        getSettings(),
        db.any(sql.worlds.all),
        db.any(sql.markets.all)
    ])

    res.render('maps', {
        title: 'All Available Maps - ' + settings.site_name,
        worlds: worlds,
        markets: markets
    })
})

router.get('/:marketId/:worldNumber', async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.render('error', {
            title: 'Tw2-Tracker Error',
            error_title: 'This world does not exist'
        })

        return false
    }

    const worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])
    const lastSync = worldInfo.last_sync ? new Date(worldInfo.last_sync).getTime() : false

    res.render('map', {
        title: 'Map ' + marketId + worldNumber + ' - ' + settings.site_name,
        exportValues: {
            marketId,
            worldNumber,
            worldName: worldInfo.name,
            lastSync,
            development: process.env.NODE_ENV === 'development'
        }
    })
})

router.get('/:marketId/:worldNumber/share/:mapShareId', async function (req, res) {
    const settings = await getSettings()
    const mapShareId = req.params.mapShareId
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    let mapShare

    const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

    if (!worldExists) {
        res.status(404)
        res.render('error', {
            title: 'Tw2-Tracker Error',
            error_title: 'This world does not exist'
        })

        return false
    }

    const worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])
    const lastSync = worldInfo.last_sync ? new Date(worldInfo.last_sync).getTime() : false

    try {
        mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber])
    } catch (error) {
        res.status(404)
        res.render('error', {
            title: 'Tw2-Tracker Error',
            error_title: 'This map share does not exist'
        })
        return false
    }

    mapShare.creation_date = new Date(mapShare.creation_date).getTime()
    mapShare.settings = JSON.parse(mapShare.settings)

    db.query(sql.maps.updateShareAccess, [mapShareId])

    res.render('map', {
        title: 'Map ' + marketId + worldNumber + ' - ' + settings.site_name,
        exportValues: {
            marketId,
            worldNumber,
            worldName: worldInfo.name,
            lastSync,
            mapShare,
            development: process.env.NODE_ENV === 'development'
        }
    })
})

router.get('/api/:marketId/:worldNumber/info/:mapShareId?', async function (req, res) {
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
        const mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, 'info')
    } else {
        dataPath = path.join('.', 'data', worldId, 'info')
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

router.get('/api/get-worlds', async function (req, res) {
    const allWorlds = await db.any(sql.worlds.allOpen)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(allWorlds))
})

router.get('/api/get-markets', async function (req, res) {
    const allMarkets = await db.map(sql.markets.withAccount, [], market => market.id)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(allMarkets))
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
        const mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, continentId)
    } else {
        dataPath = path.join('.', 'data', worldId, continentId)
    }

    res.setHeader('Content-Encoding', 'zlib')

    fs.promises.readFile(dataPath)
        .then(function (data) {
            res.end(data)
        })
        .catch(function () {
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
        shareType,
        settings,
        center
    } = req.body

    try {
        const worldExists = await checkWorldSchemaExists(marketId, worldNumber)

        if (!worldExists) {
            throw new Error('World does not exist')
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
        const { creation_date } = await db.one(sql.maps.createShare, [shareId, marketId, worldNumber, shareType, highlightsString, settingsString, center.x, center.y])

        if (shareType === mapShareTypes.STATIC) {
            const dateId = utils.getHourlyDir(creation_date)
            const worldId = marketId + worldNumber
            const copyDestination = path.join('.', 'data', 'static-maps', worldId, dateId)

            try {
                await fs.promises.access(copyDestination)
            } catch (e) {
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

router.post('/api/get-share/', async function (req, res) {
    const response = {}

    let {
        mapShareId,
        marketId,
        worldNumber,
        highlightsOnly
    } = req.body

    let mapShare

    res.setHeader('Content-Type', 'application/json')

    try {
        await db.one(sql.worlds.one, [marketId, worldNumber])
    } catch (error) {
        response.success = false
        response.message = 'World does not exist'
        return res.end(JSON.stringify(response))
    }

    try {
        const shareSql = highlightsOnly ? sql.maps.getShareHighlights : sql.maps.getShareInfo
        mapShare = await db.one(shareSql, [mapShareId, marketId, worldNumber])
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
