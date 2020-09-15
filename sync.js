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

const createPuppeteerInstance = async function () {
    const puppeteer = require('puppeteer-core')
    return await puppeteer.launch({ headless: true, executablePath: '/usr/bin/chromium' })
}

const getNumbers = function (value) {
    const num = value.match(/\d+/)
    return num ? parseInt(num[0], 10) : value
}

const checkWorldSchemaExists = async function (marketId, worldNumber) {
    const worldSchema = await db.one(sql.worldSchemaExists, [marketId + worldNumber])
    return worldSchema.exists
}

const checkWorldEntryExists = async function (marketId, worldNumber) {
    const worldEntry = await db.one(sql.worldEntryExists, [marketId, worldNumber])
    return worldEntry.exists
}

const Sync = {}

Sync.init = async function () {
    try {
        // reset db init
        // await db.query(sql.mainSiteSchema)
        // await Sync.markets()
        // await db.query(sql.createWorldSchema, {schema: 'br48'})
        // await db.query(sql.addWorldEntry, ['br', 48, 'Auto'])

        // const browser = await createPuppeteerInstance()
        // await browser.close()
    } catch (error) {
        console.log(error)
    }
}

Sync.getAllWorlds = async function (browser) {
    console.log('Sync.getAllWorlds()')

    const markets = (await db.any(sql.markets)).filter(market => market.account_name && market.account_password)
    const allWorlds = {}
    const availableWorlds = {}

    for (let i = 0; i < markets.length; i++) {
        const market = markets[i]
        let account

        try {
            account = await Sync.auth(browser, market.id, market)
        } catch (error) {
            console.log(error.message)
            continue
        }

        const allowedLoginCharacters = account.characters.filter(world => world.allow_login)
        const nonFullWorlds = account.worlds.filter(world => !world.full)

        const formatedAllowedLoginCharacters = allowedLoginCharacters.map(function (world) {
            return {
                worldNumber: getNumbers(world.world_id),
                worldName: world.world_name
            }
        })

        const formatedNonFullWorlds = nonFullWorlds.map(function (world) {
            return {
                worldNumber: getNumbers(world.id),
                worldName: world.name
            }
        })

        allWorlds[market.id] = [
            ...formatedAllowedLoginCharacters,
            ...formatedNonFullWorlds
        ]

        if (nonFullWorlds.length) {
            availableWorlds[market.id] = formatedNonFullWorlds
        }
    }

    return [allWorlds, availableWorlds]
}

Sync.registerWorlds = async function (browser) {
    console.log('Sync.registerWorlds()')

    const [allWorlds, availableWorlds] = await Sync.getAllWorlds(browser)

    console.log('allWorlds', allWorlds)
    console.log('availableWorlds', availableWorlds)

    for (let [marketId, marketWorlds] of Object.entries(availableWorlds)) {
        for (let i = 0; i < marketWorlds.length; i++) {
            const {worldNumber, worldName} = marketWorlds[i]

            await Sync.registerCharacter(browser, marketId, worldNumber)
        }
    }

    for (let [marketId, marketWorlds] of Object.entries(allWorlds)) {
        for (let i = 0; i < marketWorlds.length; i++) {
            const {worldNumber, worldName} = marketWorlds[i]

            const worldSchemaExists = await checkWorldSchemaExists(marketId, worldNumber)
            const worldEntryExists = await checkWorldEntryExists(marketId, worldNumber)

            if (!worldSchemaExists) {
                console.log('Sync.registerWorlds: Creating schema for', marketId + worldNumber)
                await db.query(sql.createWorldSchema, { schema: marketId + worldNumber })
            }

            if (!worldEntryExists) {
                console.log('Sync.registerWorlds: Creating world entry for', marketId + worldNumber)
                await db.query(sql.addWorldEntry, [marketId, worldNumber, worldName])
            }
        }
    }

    console.log('Sync.registerWorlds: Finished')
}

Sync.registerCharacter = async function (browser, marketId, worldNumber) {
    console.log('Sync.registerCharacter() market:' + marketId + ', world:' + worldNumber)

    const page = await browser.newPage()
    await page.goto(`https://${marketId}.tribalwars2.com/page`, {waitUntil: ['domcontentloaded', 'networkidle0']})

    await page.evaluate(function (marketId, worldNumber) {
        return new Promise(function (resolve) {
            const socketService = injector.get('socketService')
            const routeProvider = injector.get('routeProvider')

            socketService.emit(routeProvider.CREATE_CHARACTER, {
                world: marketId + worldNumber
            }, resolve)
        })
    }, marketId, worldNumber)

    await page.waitFor(3000)
    await page.goto(`https://${marketId}.tribalwars2.com/page`, {waitUntil: ['domcontentloaded', 'networkidle0']})
    await page.close()

    console.log('Sync.registerWorld:', 'character for', marketId + worldNumber, 'created')
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

    await page.close()

    return account
}

Sync.scrappeAll = async function (browser) {
    console.log('Sync.scrappeAll()')

    const worlds = await db.any(sql.worlds)

    for (let world of worlds) {
        await Sync.scrappeWorld(browser, world.market, world.num)
    }
}

Sync.scrappeWorld = async function (browser, marketId, worldNumber) {
    console.log('Sync.scrappeWorld()', marketId + worldNumber)

    const accountCredentials = await db.one(sql.enabledMarket, [marketId])
    const worldInfo = await db.one(sql.world, [marketId, worldNumber])

    if (worldInfo.last_sync) {
        const minutesSinceLastSync = (Date.now() - worldInfo.last_sync.getTime()) / 1000 / 60
        const settings = await db.one(sql.settings)

        if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
            throw new Error(marketId + worldNumber + ' already syncronized')
        }
    }

    const account = await Sync.auth(browser, marketId, accountCredentials)
    const page = await browser.newPage()

    page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) {
            console.log(msg._text)
        }
    })

    await page.goto(`https://${marketId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
    await page.waitForSelector('#map', { timeout: 10000 })
    await page.waitFor(2500)

    console.log('Scrapper: Start scrapping', marketId + worldNumber)

    const worldData = await page.evaluate(Scrapper)
    await page.close()
    const schema = marketId + worldNumber

    for (let id in worldData.tribes) {
        const [name, tag, points] = worldData.tribes[id]

        await db.query(sql.insertWorldTribe, {
            schema: schema,
            id: parseInt(id, 10),
            name: name,
            tag: tag,
            points: points
        })
    }

    for (let id in worldData.players) {
        const [name, points] = worldData.players[id]

        await db.query(sql.insertWorldPlayer, {
            schema: schema,
            id: parseInt(id, 10),
            name: name,
            points: points
        })
    }

    for (let x in worldData.villages) {
        for (let y in worldData.villages[x]) {
            const [id, name, points, character_id] = worldData.villages[x][y]

            await db.query(sql.insertWorldVillage, {
                schema: schema,
                id: parseInt(id, 10),
                x: x,
                y: y,
                name: name,
                points: points,
                character_id: character_id || null
            })
        }
    }

    for (let character_id in worldData.villagesByPlayer) {
        const playerVillagesCoords = worldData.villagesByPlayer[character_id]
        const playerVillages = []

        for (let i = 0; i < playerVillagesCoords.length; i++) {
            const [x, y] = playerVillagesCoords[i]
            const villageId = worldData.villages[x][y][0]

            playerVillages.push(villageId)
        }

        await db.query(sql.insertWorldPlayerVillages, {
            schema: schema,
            character_id: parseInt(character_id, 10),
            villages_id: playerVillages
        })
    }

    console.log('Scrapper:', marketId + worldNumber, 'scrapped successfully')

    await db.query(sql.updateWorldSync, [marketId, worldNumber])

    return marketId + worldNumber + ' synced successfully'
}

Sync.markets = async function () {
    console.log('Sync.markets()')

    const storedMarkets = await db.map(sql.markets, [], market => market.id)
    const marketList = await getMarketList()

    const addedMarkets = marketList.filter(function (marketId) {
        if (storedMarkets.includes(marketId)) {
            return false
        } else {
            db.query(sql.addMarketEntry, [marketId])
            return true
        }
    })

    return addedMarkets
}

module.exports = Sync
