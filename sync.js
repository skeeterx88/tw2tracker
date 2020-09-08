const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const Scrapper = require('./scrapper.js')
const ScrapperAuth = require('./scrapper-auth.js')

const parseAccounts = function (markets) {
    const accounts = {}

    markets.forEach(function (market) {
        accounts[market.id] = {
            token: market.account_token,
            playerName: market.account_name,
            id: market.account_id
        }
    })

    return accounts
}

const Sync = {}

Sync.scrappeAll = async function (callback) {
    return new Promise(async function (resolve, reject) {
        const worlds = await db.any(sql.worlds)

        worlds.forEach(async function (world) {
            await Sync.scrappeWorld(world.market, world.id)
        })

        resolve()
    })
}

Sync.scrappeWorld = async function (marketId, worldId, callback = utils.noop) {
    return new Promise(async function (resolve, reject) {
        let account
        let worldData
        let page
        let browser

        try {
            account = await db.one(sql.enabledMarket, [marketId])
            worldData = await db.one(sql.world, [marketId, worldId])
        } catch (error) {
            return reject(`Invalid world or market: ${marketId}${worldId}`)
        }

        const settings = await db.one(sql.settings)
        const minutesSinceLastSync = (Date.now() - worldData.last_sync.getTime()) / 1000 / 60

        if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
            console.log(`${world.market}${world.id} already sync.`)

            return resolve(false)
        }

        console.log(`Syncing ${marketId}${worldId}`)

        try {
            const {page, browser} = await ScrapperAuth(marketId, worldId, account)

            console.log(`Scrapping ${market}${world}`)

            const data = await page.evaluate(Scrapper, {
                allowBarbarians: settings.scrapper_allow_barbarians
            })
            await fs.writeFileSync(`data/${market}${world}.json`, JSON.stringify(data))

            console.log(`Scrapping ${market}${world} finished`)

            browser.close()

            await db.query(sql.updateWorldSync, [marketId, worldId])
            
            resolve(true)
        } catch (error) {
            return reject(error)
        }
    })
}

module.exports = Sync
