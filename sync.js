const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const Scrapper = require('./scrapper.js')
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

const createPuppeteerInstance = async function () {
    const puppeteer = require('puppeteer-core')
    return await puppeteer.launch({ headless: true, executablePath: '/usr/bin/chromium' })
}

const Sync = {}

Sync.all = async function () {
    const browser = await createPuppeteerInstance()
    await Sync.registerWorlds(browser)
    await browser.close()
}

Sync.registerWorlds = async function (browser) {
    console.log('Sync.registerWorlds()')

    const markets = await db.any(sql.markets)
    const enabledMarkets = markets.filter(market => market.account_name && market.account_password)

    if (!enabledMarkets.length) {
        console.log('Sync.registerWorlds: No enabled markets')
    }

    for (let i = 0; i < enabledMarkets.length; i++) {
        const market = enabledMarkets[i]
        let account, page

        try {
            [account, page] = await Sync.auth(browser, market.id, market)

            console.log('Sync.registerWorlds: market:' + market.id + ', missing worlds:', account.worlds.length ? account.worlds.map(world => world.id).join(', ') : 'none')

            if (account.worlds.length) {
                for (let j = 0; j < account.worlds.length; j++) {
                    const world = account.worlds[j]
                    const worldId = parseInt(world.id.match(/\d+/)[0], 10)

                    await Sync.registerWorld(page, market.id, worldId, world.name)
                }

                console.log('Sync.registerWorlds: All worlds for market:' + market.id, 'registered')
            } else {
                console.log('Sync.registerWorlds: All worlds for market:' + market.id, 'already registered')
            }

            // Create world schema for existing character in case it was not
            // created before.
            if (account.characters.length) {
                for (let c = 0; c < account.characters.length; c++) {
                    const character = account.characters[c]
                    const worldNumber = parseInt(character.world_id.match(/\d+/)[0], 10)
                    const worldSchema = await db.one(sql.worldSchemaExists, [character.world_id])

                    if (!worldSchema.exists) {
                        console.log('Sync.registerWorlds: Creating schema for', character.world_id)
                        await db.query(sql.createWorldSchema, { schema: character.world_id })
                    }

                    const worldRow = await db.one(sql.worldExists, [market.id, worldNumber])

                    if (!worldRow.exists) {
                        await db.query(sql.addWorld, [market.id, worldNumber, character.world_name])
                    }
                }
            }
        } catch (error) {
            console.log('Sync.registerWorlds: Error while trying to register characters on market:' + market.id, ' | ', (error.message || error))
            continue
        }

        page.close()
    }

    console.log('Sync.registerWorlds: Finish')
}

Sync.registerWorld = async function (page, marketId, worldId, worldName) {
    console.log('Sync.registerWorld() market:' + marketId + ', world:' + worldId + ', world name:' + worldName)

    await page.evaluate(function (marketId, worldId) {
        return new Promise(function (resolve) {
            const socketService = injector.get('socketService')
            const routeProvider = injector.get('routeProvider')

            socketService.emit(routeProvider.CREATE_CHARACTER, {
                world: marketId + worldId
            }, resolve)
        })
    }, marketId, worldId)

    await page.waitFor(500)

    await page.goto(`https://${marketId}.tribalwars2.com/page`, {
        waitUntil: ['domcontentloaded', 'networkidle0']
    })

    console.log('Sync.registerWorlds: Creating schema for', marketId + worldId)
    await db.query(sql.createWorldSchema, { schema: marketId + worldId })
    await db.query(sql.addWorld, [marketId, worldId, worldName])

    console.log('Sync.registerWorld:', 'character for', marketId + worldId, 'created')

    // create world database

    return true
}

Sync.auth = async function (browser, marketId, { account_name, account_password }) {
    console.log('Sync.auth() market:' + marketId + ', account:' + account_name)

    const page = await browser.newPage()

    await page.goto(`https://${marketId}.tribalwars2.com/page`, {
        waitUntil: ['domcontentloaded', 'networkidle0']
    })

    const account = await page.evaluate(function (account_name, account_password) {
        return new Promise(function (resolve) {
            const socketService = injector.get('socketService')
            const routeProvider = injector.get('routeProvider')

            const loginTimeout = setTimeout(function () {
                resolve(false)
            }, 5000)

            socketService.emit(routeProvider.LOGIN, {
                name: account_name,
                pass: account_password,
                ref_param: ''
            }, function (data) {
                clearTimeout(loginTimeout)
                resolve(data)
            })
        })
    }, account_name, account_password)

    if (!account) {
        throw new Error('Sync: Authentication failed')
    }

    await page.setCookie({
        name: 'globalAuthCookie',
        value: JSON.stringify({
            token: account.token,
            playerName: account.name,
            autologin: true
        }),
        domain: `.${marketId}.tribalwars2.com`,
        path: '/',
        expires: 2147482647,
        size: 149,
        httpOnly: false,
        secure: false,
        session: false
    })

    await page.goto(`https://${marketId}.tribalwars2.com/page`, {
        waitUntil: ['domcontentloaded', 'networkidle0']
    })

    return [account, page]
}

Sync.scrappeAll = async function (callback) {
    const worlds = await db.any(sql.worlds)
    const browser = await createPuppeteerInstance()

    worlds.forEach(async function (world) {
        await Sync.scrappeWorld(browser, world.market, world.id)
    })
}

Sync.scrappeWorld = async function (browser, marketId, worldId, callback = utils.noop) {
    const accountCredentials = await db.one(sql.enabledMarket, [marketId])
    const worldInfo = await db.one(sql.world, [marketId, worldId])
    const minutesSinceLastSync = (Date.now() - worldInfo.last_sync.getTime()) / 1000 / 60
    const settings = await db.one(sql.settings)

    if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
        throw new Error(marketId + worldId + ' already syncronized')
    }

    const [account, page] = await Sync.auth(browser, marketId, accountCredentials)

    console.log('Scrapper: Start scrapping', marketId + worldId)

    const dbWorld = connectWorldDatabase(marketId, worldId)

    await page.goto(`https://${marketId}.tribalwars2.com/game.php?world=${marketId}${worldId}&character_id=${account.account_id}`)
    await page.waitFor(2500)
    await page.waitForSelector('#map', { timeout: 10000 })
    const worldData = await page.evaluate(Scrapper)

    await insertWorldData(dbWorld, worldData)

    console.log('Scrapper:', marketId + worldId, 'scrapped successfully')
    page.close()

    await db.query(sql.updateWorldSync, [marketId, worldId])
    
    return marketId + worldId + ' synced successfully'
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
