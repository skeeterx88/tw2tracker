const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
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

            // const now = Date.now()
            // const lastSync = world.last_sync
            // const diff = (now - lastSync.getTime()) / 1000 / 60

            // if (diff > settings.scrapper_interval_minutes) {
            //     console.log(`Syncing ${world.market}${world.id}`)

            //     const account = accounts[world.market]
            //     await ScrapperAuth(world.market, world.id, account)
            //     await db.query(sql.updateWorldSync, [market, world])
            // }
        })

        resolve()
    })
}

Sync.scrappeWorld = async function (marketId, worldId, callback = utils.noop) {
    return new Promise(async function (resolve, reject) {
        try {
            const marketData = await db.one(sql.market, [marketId])
            const worldData = await db.one(sql.world, [marketId, worldId])

            const settings = await db.one(sql.settings)
            const accounts = parseAccounts([marketData])
            const minutesSinceLastSync = (Date.now() - worldData.last_sync.getTime()) / 1000 / 60

            if (minutesSinceLastSync > settings.scrapper_interval_minutes) {
                console.log(`Syncing ${worldData.market}${worldData.id}`)

                const account = accounts[worldData.market]
                await ScrapperAuth(marketId, worldId, account)
                await db.query(sql.updateWorldSync, [marketId, worldId])
                
                resolve(true)
            } else {
                console.log(`${world.market}${world.id} already sync.`)
                resolve(false)
            }
        } catch (error) {
            reject('Invalid world or market: ' + marketId + worldId)
        }
    })
}

module.exports = Sync
