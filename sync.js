const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const Scrapper = require('./scrapper.js')
const readyState = require('./ready-state.js')
const getStructPath = require('./get-struct-path.js')
const fs = require('fs')
const https = require('https')
const authenticatedMarkets = {}
const zlib = require('zlib')
const path = require('path')

const IGNORE_LAST_SYNC = 'ignore_last_sync'

let browser = null
let page = null

const getHTML = function (url) {
    return new Promise(function (resolve) {
        const HTMLParser = require('fast-html-parser')

        https.get(url, function (res) {
            res.setEncoding('utf8')

            let body = ''

            res.on('data', data => { body += data })
            res.on('end', async function () {
                resolve(HTMLParser.parse(body))
            })
        })
    })
}

const puppeteerBrowser = async function () {
    if (!browser) {
        const puppeteer = require('puppeteer-core')

        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/chromium'
        })
    }
}

const puppeteerPage = async function () {
    if (!browser) {
        await puppeteerBrowser()
    }

    if (!page) {
        page = await browser.newPage()

        page.on('console', function (msg) {
            if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) {
                console.log(msg._text)
            }
        })
    }
}

const Sync = {}

Sync.init = async function () {
    process.on('SIGTERM', async function () {
        console.log('Stopping tw2tracker')
        process.exit()
    })

    try {
        await Sync.createInitialStructure()

        if (process.env.NODE_ENV !== 'development') {
            await Sync.daemon()
        }
    } catch (error) {
        console.log(error)
    }
}

Sync.createInitialStructure = async function () {
    const mainSchamaExists = await utils.schemaExists('main')

    if (!mainSchamaExists) {
        await fs.promises.mkdir(path.join('.', 'data'), { recursive: true })
        await db.query(sql.mainSiteSchema)
        await Sync.markets()
        await Sync.registerWorlds()
        await Sync.scrappeAllWorlds()
    }
}

Sync.daemon = async function () {
    console.log('Sync.daemon()')

    const CronJob = require('cron').CronJob

    const scrappeJob = new CronJob('0 */1 * * *', async function () {
        await Sync.scrappeAllWorlds()
    })

    const marketsJob = new CronJob('0 1 * * *', async function () {
        await Sync.markets()
        await Sync.registerWorlds()
    })

    scrappeJob.start()
    marketsJob.start()
}

Sync.fetchAllWorlds = async function () {
    console.log('Sync.fetchAllWorlds()')

    await puppeteerBrowser()

    const markets = (await db.any(sql.markets)).filter(market => market.account_name && market.account_password)
    const allWorlds = {}
    const availableWorlds = {}

    for (let i = 0; i < markets.length; i++) {
        const market = markets[i]
        let account

        try {
            account = await Sync.auth(market.id, market)
        } catch (error) {
            console.log(error.message)
            continue
        }

        const allowedLoginCharacters = account.characters.filter(world => world.allow_login)
        const nonFullWorlds = account.worlds.filter(world => !world.full)

        const formatedAllowedLoginCharacters = allowedLoginCharacters.map(function (world) {
            return {
                worldNumber: utils.extractNumbers(world.world_id),
                worldName: world.world_name
            }
        })

        const formatedNonFullWorlds = nonFullWorlds.map(function (world) {
            return {
                worldNumber: utils.extractNumbers(world.id),
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

        console.log('Sync.fetchAllWorlds: market:' + market.id + ' worlds:', allWorlds[market.id].map(world => world.worldNumber).join(','))
    }

    return [allWorlds, availableWorlds]
}

Sync.registerWorlds = async function () {
    console.log('Sync.registerWorlds()')

    const [allWorlds, availableWorlds] = await Sync.fetchAllWorlds()

    for (let [marketId, marketWorlds] of Object.entries(availableWorlds)) {
        for (let i = 0; i < marketWorlds.length; i++) {
            const {worldNumber, worldName} = marketWorlds[i]

            await Sync.registerCharacter(marketId, worldNumber)
        }
    }

    for (let [marketId, marketWorlds] of Object.entries(allWorlds)) {
        for (let i = 0; i < marketWorlds.length; i++) {
            const {worldNumber, worldName} = marketWorlds[i]

            const worldSchemaExists = await utils.schemaExists(marketId + worldNumber)
            const worldEntryExists = await utils.worldEntryExists(marketId, worldNumber)

            if (!worldSchemaExists) {
                console.log('Sync.registerWorlds: Creating schema for', marketId + worldNumber)
                await db.query(sql.createWorldSchema, {schema: marketId + worldNumber})
            }

            if (!worldEntryExists) {
                console.log('Sync.registerWorlds: Creating world entry for', marketId + worldNumber)
                await db.query(sql.addWorldEntry, [marketId, worldNumber, worldName, true])
            }
        }
    }

    console.log('Sync.registerWorlds: Finished')
}

Sync.registerCharacter = async function (marketId, worldNumber) {
    console.log('Sync.registerCharacter() market:' + marketId + ', world:' + worldNumber)

    await puppeteerPage()
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

    console.log('Sync.registerWorld:', 'character for', marketId + worldNumber, 'created')
}

Sync.auth = async function (marketId, { account_name, account_password }) {
    if (marketId in authenticatedMarkets && authenticatedMarkets[marketId].name === account_name) {
        const account = authenticatedMarkets[marketId]
        console.log('Sync.auth() market:' + marketId + ', already authenticated with account', account.name)
        return account
    }

    console.log('Sync.auth() market:' + marketId + ', account:' + account_name)

    await puppeteerPage()

    try {
        const urlId = marketId === 'zz' ? 'beta' : marketId

        await page.goto(`https://${urlId}.tribalwars2.com/page`, {
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
            const errorMessage = await page.$eval('.login-error .error-message', $elem => $elem.textContent)

            throw new Error('Sync.auth: Authentication to market:' + marketId + ' failed "' + errorMessage + '"')
        }

        await page.setCookie({
            name: 'globalAuthCookie',
            value: JSON.stringify({
                token: account.token,
                playerName: account.name,
                autologin: true
            }),
            domain: `.${urlId}.tribalwars2.com`,
            path: '/',
            expires: 2147482647,
            size: 149,
            httpOnly: false,
            secure: false,
            session: false
        })

        await page.goto(`https://${urlId}.tribalwars2.com/page`, { waitUntil: ['domcontentloaded', 'networkidle0'] })

        try {
            await page.waitForSelector('.player-worlds', { timeout: 3000 })
        } catch (error) {
            throw new Error('Sync.auth: Authentication to market:' + marketId + ' failed "unknown reason"')
        }

        authenticatedMarkets[marketId] = account

        return account
    } catch (error) {
        throw new Error(error.message)
    }
}

Sync.scrappeAllWorlds = async function (flag) {
    console.log('Sync.scrappeAllWorlds()')

    let worlds

    if (process.env.NODE_ENV === 'development') {
        worlds = [{
            market: 'de',
            num: 48
        }, {
            market: 'br',
            num: 48
        }, {
            market: 'en',
            num: 56
        }]
    } else {
        worlds = await db.any(sql.openWorlds)
    }

    for (let world of worlds) {
        try {
            await Sync.scrappeWorld(world.market, world.num, flag)
        } catch (error) {
            console.log(error.message)
        }
    }

    console.log('Sync.scrappeAllWorlds: Finished')
}

const downloadStruct = function (url, marketId, worldNumber) {
    return new Promise(function (resolve) {
        https.get(url, function (res) {
            let data = []

            res.on('data', function (chunk) {
                data.push(chunk)
            })

            res.on('end', async function () {
                await fs.promises.mkdir(path.join('.', 'data', marketId + worldNumber), { recursive: true })
                const gzipped = zlib.gzipSync(Buffer.concat(data))
                await fs.promises.writeFile(path.join('.', 'data', marketId + worldNumber, 'struct'), gzipped)
                resolve()
            })
        })
    })
}

Sync.scrappeWorld = async function (marketId, worldNumber, flag) {
    console.log('Sync.scrappeWorld()', marketId + worldNumber)

    const accountCredentials = await db.one(sql.enabledMarket, [marketId])
    const worldInfo = await db.one(sql.world, [marketId, worldNumber])
    const urlId = marketId === 'zz' ? 'beta' : marketId

    if (!worldInfo.open) {
        throw new Error('Sync.scrappeWorld: World ' + marketId + worldNumber + ' is closed')
    }

    if (flag !== IGNORE_LAST_SYNC && worldInfo.last_sync) {
        const minutesSinceLastSync = (Date.now() - worldInfo.last_sync.getTime()) / 1000 / 60
        const settings = await db.one(sql.settings)

        if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
            throw new Error('Sync.scrappeWorld: ' + marketId + worldNumber + ' already sincronized')
        }
    }

    await puppeteerPage()

    try {
        const account = await Sync.auth(marketId, accountCredentials)
        const worldCharacter = account.characters.find(function ({ world_id }) {
            return world_id === marketId + worldNumber
        })

        if (!worldCharacter.allow_login) {
            await db.query(sql.updateWorldLocked, [marketId, worldNumber])
            throw new Error('world is not open')
        }


        await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
        await page.evaluate(readyState)

        try {
            await fs.promises.access(path.join('.', 'data', marketId + worldNumber, 'struct'))
        } catch (_) {
            console.log('Sync.scrappeWorld: Downloading map structure')
            const structPath = await page.evaluate(getStructPath)
            await downloadStruct(`https://${urlId}.tribalwars2.com/${structPath}`, marketId, worldNumber)
        }

        const worldData = await page.evaluate(Scrapper, marketId, worldNumber)

        const schema = marketId + worldNumber

        console.log('Sync.scrappeWorld: Saving ' + marketId + worldNumber + ' data')

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
            const [name, points, tribe_id] = worldData.players[id]

            await db.query(sql.insertWorldPlayer, {
                schema,
                id: parseInt(id, 10),
                name,
                tribe_id,
                points
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

        await db.query(sql.updateWorldSync, [marketId, worldNumber])
        await Sync.genWorldBlocks(marketId, worldNumber)

        console.log('Sync.scrappeWorld:', marketId + worldNumber, 'scrapped')
    } catch (error) {
        throw new Error('Sync.scrappeWorld: Failed to synchronize ' + marketId + worldNumber + ' (' + error.message + ')')
    }
}

Sync.markets = async function () {
    console.log('Sync.markets()')

    const storedMarkets = await db.map(sql.markets, [], market => market.id)
    const $portalBar = await getHTML('https://tribalwars2.com/portal-bar/https/portal-bar.html')
    const $markets = $portalBar.querySelectorAll('.pb-lang-sec-options a')
    
    const marketList = $markets.map(function ($market) {
        const market = $market.attributes.href.split('//')[1].split('.')[0]
        return market === 'beta' ? 'zz' : market
    })

    const missingMarkets = marketList.filter(marketId => !storedMarkets.includes(marketId))

    for (let missingMarket of missingMarkets) {
        await db.query(sql.addMarketEntry, missingMarket)
    }

    return missingMarkets
}

Sync.genWorldBlocks = async function (marketId, worldNumber) {
    console.log('Sync.genWorldBlocks()', marketId + worldNumber)

    const worldId = marketId + worldNumber
    const players = await db.any(sql.worldData, { worldId, table: 'players' })
    const villages = await db.any(sql.worldData, { worldId, table: 'villages' })
    const tribes = await db.any(sql.worldData, { worldId, table: 'tribes' })

    const parsedPlayers = {}
    const parsedTribes = {}
    const continents = {}

    const dataPath = path.join('.', 'data', worldId)

    await fs.promises.mkdir(dataPath, { recursive: true })

    for (let village of villages) {
        let { id, x, y, name, points, character_id } = village

        let kx
        let ky

        if (x < 100) {
            kx = '0'
        } else {
            kx = String(x)[0]
        }

        if (y < 100) {
            ky = '0'
        } else {
            ky = String(y)[0]
        }

        const k = parseInt(ky + kx, 10)

        if (!continents.hasOwnProperty(k)) {
            continents[k] = {}
        }

        if (!continents[k].hasOwnProperty(x)) {
            continents[k][x] = {}
        }

        continents[k][x][y] = [id, name, points, character_id || 0]
    }

    for (let k in continents) {
        const data = JSON.stringify(continents[k])
        await fs.promises.writeFile(path.join(dataPath, k), zlib.gzipSync(data))
    }

    for (let { id, name, tribe_id, points } of players) {
        parsedPlayers[id] = [name, tribe_id || 0, points]
    }

    for (let { id, name, tag, points } of tribes) {
        parsedTribes[id] = [name, tag, points]
    }

    const gzippedPlayers = zlib.gzipSync(JSON.stringify(parsedPlayers))
    const gzippedTribes = zlib.gzipSync(JSON.stringify(parsedTribes))

    await fs.promises.writeFile(path.join(dataPath, 'players'), gzippedPlayers)
    await fs.promises.writeFile(path.join(dataPath, 'tribes'), gzippedTribes)

    console.log('Sync.genWorldBlocks:', worldId, 'finished')

    return true
}

module.exports = Sync
