const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const Scrapper = require('./scrapper.js')
const ScrapperAuth = require('./scrapper-auth.js')
const fs = require('fs')

const getMarketList = function () {
    return new Promise(function (resolve) {
        const https = require('https')
        const HTMLParser = require('fast-html-parser')

        https.get('https://en.tribalwars2.com/portal-bar/https/portal-bar.html', function (res) {
            res.setEncoding('utf8')

            let body = ''

            res.on('data', data => {
                body += data
            })

            res.on('end', async function () {
                const root = HTMLParser.parse(body)
                const marketElements = root.querySelectorAll('.pb-lang-sec-options a')

                const markets = marketElements.map(function (elem) {
                    const marketUrl = elem.attributes.href
                    return marketUrl.split('//')[1].split('.')[0]
                })

                resolve(markets)
            })
        })
    })
}

const connectWorldDatabase = async function (marketId, worldId) {
    const settings = await db.one(sql.settings)
    const pgp = require('pg-promise')()
    return pgp({
        user: settings.db_user,
        host: settings.db_host,
        database: 'tw2tracker-' + marketId + worldId,
        password: settings.db_password,
        port: settings.db_port
    })
}

const insertWorldData = async function (dbWorld, worldData) {
    const {villages, villagesByPlayer, players, tribes, updated} = worldData

    for (let id in tribes) {
        const [name, tag, points] = tribes[id]

        await dbWorld.query(sql.insertWorldTribe, [
            parseInt(id, 10),
            name,
            tag,
            points
        ])
    }

    for (let id in players) {
        const [name, points] = players[id]

        await dbWorld.query(sql.insertWorldPlayer, [
            parseInt(id, 10),
            name,
            points
        ])
    }

    for (let x in villages) {
        for (let y in villages[x]) {
            const [id, name, points, character_id] = villages[x][y]

            await dbWorld.query(sql.insertWorldVillage, [
                parseInt(id, 10),
                x,
                y,
                name,
                points,
                character_id || null
            ])
        }
    }

    for (let character_id in villagesByPlayer) {
        const playerVillagesCoords = villagesByPlayer[character_id]
        const playerVillages = []

        for (let i = 0; i < playerVillagesCoords.length; i++) {
            const [x, y] = playerVillagesCoords[i]
            const villageId = villages[x][y][0]

            playerVillages.push(villageId)
        }

        await dbWorld.query(sql.insertWorldPlayerVillages, [
            parseInt(character_id, 10),
            playerVillages
        ])
    }
}

const Sync = {}

Sync.scrappeAll = async function (callback) {
    const worlds = await db.any(sql.worlds)

    worlds.forEach(async function (world) {
        await Sync.scrappeWorld(world.market, world.id)
    })
}

Sync.scrappeWorld = async function (marketId, worldId, callback = utils.noop) {
    const account = await db.one(sql.enabledMarket, [marketId])
    const worldInfo = await db.one(sql.world, [marketId, worldId])
    const minutesSinceLastSync = (Date.now() - worldInfo.last_sync.getTime()) / 1000 / 60
    const settings = await db.one(sql.settings)

    if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
        return [false, marketId + worldId + ' already syncronized']
    }

    const [page, browser] = await ScrapperAuth(marketId, worldId, account)

    console.log('Scrapper: Start scrapping', marketId + worldId)

    const dbWorld = connectWorldDatabase(marketId, worldId)
    const worldData = await page.evaluate(Scrapper)
    
    await insertWorldData(dbWorld, worldData)

    console.log('Scrapper:', marketId + worldId, 'scrapped successfully')
    browser.close()

    await db.query(sql.updateWorldSync, [marketId, worldId])
    
    return [true, marketId + worldId + ' synced successfully']
}

Sync.markets = async function () {
    const storedMarkets = await db.map(sql.markets, [], market => market.id)
    const marketList = await getMarketList()

    const addedMarkets = marketList.filter(function (marketId) {
        if (storedMarkets.includes(marketId)) {
            return false
        } else {
            db.query(sql.addMarket, [marketId])
            return true
        }
    })

    return addedMarkets
}

module.exports = Sync
