const fs = require('fs')
const path = require('path')
const express = require('express')
const createError = require('http-errors')
const router = express.Router()

const db = require('../db.js')
const sql = require('../sql.js')
const utils = require('../utils.js')
const enums = require('../enums.js')
const {paramWorldParse} = require('../router-helpers.js')

const GZIP_EMPTY_CONTINENT = Buffer.from([31,139,8,0,0,0,0,0,0,3,171,174,5,0,67,191,166,163,2,0,0,0])

const getWorldInfoRouter = utils.asyncRouter(async function (req, res) {
    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    let dataPath

    if (req.params.mapShareId) {
        const mapShare = await db.one(sql.maps.getShareInfo, [req.params.mapShareId, marketId, worldNumber])
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
})

const getOpenWorldsRouter = utils.asyncRouter(async function (req, res) {
    const allWorlds = await db.any(sql.getOpenWorlds)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(allWorlds))
})

const getMarketsRouters = utils.asyncRouter(async function (req, res) {
    const allMarkets = await db.map(sql.markets.withAccount, [], market => market.id)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(allMarkets))
})

const getContinentRouter = utils.asyncRouter(async function (req, res) {
    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req)

    const continentId = req.params.continentId

    if (continentId < 0 || continentId > 99 || isNaN(continentId)) {
        throw createError(400, 'Invalid continent')
    }

    let dataPath

    if (req.params.mapShareId) {
        const mapShare = await db.one(sql.maps.getShareInfo, [req.params.mapShareId, marketId, worldNumber])
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
        etag = enums.EMPTY_CONTINENT

        if (ifNoneMatchValue && ifNoneMatchValue === etag) {
            res.status(304)
            return res.end()
        }

        data = GZIP_EMPTY_CONTINENT
    }

    res.setHeader('ETag', etag)
    res.end(data)
})

const getStructRouter = utils.asyncRouter(async function (req, res) {
    const {
        worldId
    } = await paramWorldParse(req)

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
})

const crateShareRouter = utils.asyncRouter(async function (req, res) {
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

    if (shareType === enums.mapShareTypes.STATIC) {
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
})

const getShareRouter = utils.asyncRouter(async function (req, res) {
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
})

router.get('/api/:marketId/:worldNumber/info/:mapShareId?', getWorldInfoRouter)
router.get('/api/get-open-worlds', getOpenWorldsRouter)
router.get('/api/get-markets', getMarketsRouters)
router.get('/api/:marketId/:worldNumber/continent/:continentId/:mapShareId?', getContinentRouter)
router.get('/api/:marketId/:worldNumber/struct', getStructRouter)
router.post('/api/create-share', crateShareRouter)
router.post('/api/get-share/', getShareRouter)

module.exports = router
