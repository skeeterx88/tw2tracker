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

            res.on('end', async () => {
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

const Sync = {}

Sync.scrappeAll = async function (callback) {
    const worlds = await db.any(sql.worlds)

    worlds.forEach(async function (world) {
        await Sync.scrappeWorld(world.market, world.id)
    })
}

Sync.scrappeWorld = async function (marketId, worldId, callback = utils.noop) {
    const account = await db.one(sql.enabledMarket, [marketId])
    const worldData = await db.one(sql.world, [marketId, worldId])
    const settings = await db.one(sql.settings)
    const minutesSinceLastSync = (Date.now() - worldData.last_sync.getTime()) / 1000 / 60

    if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
        console.log(`${world.market}${world.id} already sync.`)

        return false
    }

    const [page, browser] = await ScrapperAuth(marketId, worldId, account)

    console.log(`Scrapping ${marketId}${worldId}`)

    const data = await page.evaluate(Scrapper, {
        allowBarbarians: settings.scrapper_allow_barbarians
    })

    await fs.writeFileSync(`data/${marketId}${worldId}.json`, JSON.stringify(data))

    console.log(`Scrapping ${marketId}${worldId} finished`)

    browser.close()

    await db.query(sql.updateWorldSync, [marketId, worldId])
    
    return true
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
