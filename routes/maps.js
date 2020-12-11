const fs = require('fs')
const path = require('path')
const express = require('express')
const createError = require('http-errors')
const router = express.Router()
const utils = require('../utils')
const {asyncRouter} = utils
const getSettings = require('../settings')
const development = process.env.NODE_ENV === 'development'
const GZIP_EMPTY_CONTINENT = Buffer.from([31,139,8,0,0,0,0,0,0,3,171,174,5,0,67,191,166,163,2,0,0,0])
const EMPTY_CONTINENT = 'empty_continent'

const {db} = require('../db')
const sql = require('../sql')

const mapShareTypes = {
    STATIC: 'static',
    DYNAMIC: 'dynamic'
}

router.get('/', asyncRouter(async function (req, res, next) {
    const settings = await getSettings()
    const worlds = await db.any(sql.worlds.all)
    const marketsIds = Array.from(new Set(worlds.map(world => world.market)))
    const markets = marketsIds.map(function (marketId) {
        return {
            id: marketId,
            player_count: worlds.reduce((base, next) => next.market === marketId ? base + next.player_count : base, 0),
            tribe_count: worlds.reduce((base, next) => next.market === marketId ? base + next.tribe_count : base, 0),
            village_count: worlds.reduce((base, next) => next.market === marketId ? base + next.village_count : base, 0),
            open_world_count: worlds.reduce((base, next) => next.market === marketId && next.open ? base + 1 : base, 0),
            closed_world_count: worlds.reduce((base, next) => next.market === marketId && !next.open ? base + 1 : base, 0)
        }
    })

    res.render('maps-home', {
        title: `Maps - Server List - ${settings.site_name}`,
        markets,
        navigation: [
            `<a href="/maps">Maps</a>`,
            `Server List`
        ],
        ...utils.ejsHelpers
    })
}))

router.get('/:marketId', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const marketWorlds = await db.any(sql.stats.marketWorlds, {marketId})
    const sortedWorlds = marketWorlds.sort((a, b) => a.num - b.num)

    if (!marketWorlds.length) {
        throw createError(404, 'This server does not exist or does not have any available world')
    }

    const worlds = [
        ['Open Worlds', sortedWorlds.filter(world => world.open)],
        ['Closed Worlds', sortedWorlds.filter(world => !world.open)]
    ]

    res.render('maps-server', {
        title: `Maps ${marketId.toUpperCase()} - World List - ${settings.site_name}`,
        marketId,
        worlds,
        navigation: [
            `<a href="/maps">Maps</a>`,
            `Server <a href="/maps/${marketId}/">${marketId.toUpperCase()}</a>`,
            'World List'
        ],
        exportValues: {
            marketId
        },
        ...utils.ejsHelpers
    })
}))

router.get('/:marketId/:worldNumber', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber

    try {
        await fs.promises.access(path.join('.', 'data', worldId, 'info'))
    } catch (error) {
        throw createError(404, 'This world does not exist')
    }

    if (!await utils.schemaExists(worldId)) {
        throw createError(404, 'This world does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const lastSync = world.last_sync ? new Date(world.last_sync).getTime() : false

    res.render('map', {
        title: `Map ${marketId.toUpperCase()}/${world.name} - ${settings.site_name}`,
        marketId,
        world,
        exportValues: {
            marketId,
            worldNumber,
            worldName: world.name,
            lastSync,
            development
        }
    })
}))

router.get('/:marketId/:worldNumber/share/:mapShareId', asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next()
    }

    const settings = await getSettings()
    const mapShareId = req.params.mapShareId
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)

    let mapShare

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        throw createError(404, 'This world does not exist')
    }

    const world = await db.one(sql.worlds.one, [marketId, worldNumber])
    const lastSync = world.last_sync ? new Date(world.last_sync).getTime() : false

    try {
        mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber])
    } catch (error) {
        throw createError(404, 'This map share does not exist')
    }

    mapShare.creation_date = new Date(mapShare.creation_date).getTime()
    mapShare.settings = JSON.parse(mapShare.settings)

    db.query(sql.maps.updateShareAccess, [mapShareId])

    res.render('map', {
        title: `Map ${marketId.toUpperCase()}/${world.name} - Shared - ${settings.site_name}`,
        marketId,
        world,
        exportValues: {
            marketId,
            worldNumber,
            worldName: world.name,
            lastSync,
            mapShare,
            development
        }
    })
}))

router.get('/api/:marketId/:worldNumber/info/:mapShareId?', asyncRouter(async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const mapShareId = req.params.mapShareId
    const worldId = marketId + worldNumber

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        throw createError(404, 'World does not exist')
    }

    let dataPath

    if (mapShareId) {
        const mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, 'info')
    } else {
        dataPath = path.join('.', 'data', worldId, 'info')
    }

    try {
        await fs.promises.access(dataPath)
    } catch (error) {
        throw createError(500, 'Share data not found')
    }

    const ifNoneMatchValue = req.headers['if-none-match']
    const dataStats = await fs.promises.lstat(dataPath)
    const etag = utils.sha1sum(dataStats.mtime.toISOString())

    if (ifNoneMatchValue && ifNoneMatchValue === etag) {
        res.status(304)
        return res.end()
    }

    const data = await fs.promises.readFile(dataPath)

    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Cache-Control', 'no-cache, max-age=31536000')
    res.setHeader('Vary', 'ETag')
    res.setHeader('ETag', etag)
    res.end(data)
}))

router.get('/api/get-open-worlds', asyncRouter(async function (req, res) {
    const allWorlds = await db.any(sql.worlds.allOpen)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(allWorlds))
}))

router.get('/api/get-markets', asyncRouter(async function (req, res) {
    const allMarkets = await db.map(sql.markets.withAccount, [], market => market.id)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(allMarkets))
}))

router.get('/api/:marketId/:worldNumber/continent/:continentId/:mapShareId?', asyncRouter(async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    const continentId = req.params.continentId
    const mapShareId = req.params.mapShareId

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        throw createError(404, 'World does not exist')
    }

    if (continentId < 0 || continentId > 99 || isNaN(continentId)) {
        throw createError(400, 'Invalid continent')
    }

    let dataPath

    if (mapShareId) {
        const mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber])
        const dateId = utils.getHourlyDir(mapShare.creation_date)
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, continentId)
    } else {
        dataPath = path.join('.', 'data', worldId, continentId)
    }

    let data
    let etag

    const ifNoneMatchValue = req.headers['if-none-match']

    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Cache-Control', 'no-cache, max-age=31536000')
    res.setHeader('Vary', 'ETag')

    try {
        await fs.promises.access(dataPath)
        const dataStats = await fs.promises.lstat(dataPath)
        etag = utils.sha1sum(dataStats.mtime.toISOString())

        if (ifNoneMatchValue && ifNoneMatchValue === etag) {
            res.status(304)
            return res.end()
        }

        data = await fs.promises.readFile(dataPath)
    } catch (error) {
        etag = EMPTY_CONTINENT

        if (ifNoneMatchValue && ifNoneMatchValue === etag) {
            res.status(304)
            return res.end()
        }

        data = GZIP_EMPTY_CONTINENT
    }

    res.setHeader('ETag', etag)
    res.end(data)
}))

router.get('/api/:marketId/:worldNumber/struct', asyncRouter(async function (req, res) {
    const marketId = req.params.marketId
    const worldNumber = parseInt(req.params.worldNumber, 10)
    const worldId = marketId + worldNumber
    
    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        throw createError(404, 'World does not exist')
    }

    const structPath = path.join('.', 'data', worldId, 'struct')

    try {
        await fs.promises.access(structPath)
    } catch (error) {
        throw createError(500, 'Struct data not found')
    }

    const ifNoneMatchValue = req.headers['if-none-match']
    const structStats = await fs.promises.lstat(structPath)
    const etag = utils.sha1sum(structStats.mtime.toISOString())

    if (ifNoneMatchValue && ifNoneMatchValue === etag) {
        res.status(304)
        return res.end()
    }

    const struct = await fs.promises.readFile(structPath)

    res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Cache-Control', 'no-cache, max-age=31536000')
    res.setHeader('Vary', 'ETag')
    res.setHeader('ETag', etag)
    res.end(struct)
}))

router.post('/api/create-share', asyncRouter(async function (req, res) {
    const {
        marketId,
        worldNumber,
        highlights,
        shareType,
        settings,
        center
    } = req.body

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        res.status(404)
        res.end('World does not exist')
        return
    }

    if (!highlights || !Array.isArray(highlights)) {
        res.status(400)
        res.end('Invalid highlights data')
        return
    }

    if (!highlights.length) {
        res.status(400)
        res.end('No highlights specified')
        return
    }

    const highlightsString = JSON.stringify(highlights)
    const shareId = utils.makeid(20)

    const settingsString = JSON.stringify(settings)
    const {creation_date} = await db.one(sql.maps.createShare, [shareId, marketId, worldNumber, shareType, highlightsString, settingsString, center.x, center.y])

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

    res.end(`/maps/${marketId}/${worldNumber}/share/${shareId}`)
}))

router.post('/api/get-share/', asyncRouter(async function (req, res) {
    let {
        mapShareId,
        marketId,
        worldNumber,
        highlightsOnly
    } = req.body

    const worldExists = await utils.schemaExists(marketId + worldNumber)

    if (!worldExists) {
        res.status(404)
        res.end('World does not exist')
        return
    }

    try {
        const shareSql = highlightsOnly ? sql.maps.getShareHighlights : sql.maps.getShareInfo
        const mapShare = await db.one(shareSql, [mapShareId, marketId, worldNumber])

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(mapShare))
    } catch (error) {
        res.status(404)
        res.end('Map share does not exist')
    }
}))

module.exports = router
