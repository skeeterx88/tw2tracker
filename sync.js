const db = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const {log} = utils
const Scrapper = require('./scrapper.js')
const readyState = require('./ready-state.js')
const getSettings = require('./settings')
const fs = require('fs')
const schedule = require('node-schedule')
const zlib = require('zlib')
const path = require('path')
const hasOwn = Object.prototype.hasOwnProperty
const colors = require('colors/safe')
const development = process.env.NODE_ENV === 'development'
let logLevel = 0
let fullSyncInProgress = false
let authenticatedMarkets = {}

const IGNORE_LAST_SYNC = 'ignore_last_sync'

const SUCCESS = 'success'
const FAIL = 'fail' 
const SUCCESS_SYNC_ALL = 0
const ERROR_SYNC_ALL = 1
const ERROR_SYNC_SOME = 2

let browser = null

const puppeteerBrowser = async function () {
    if (!browser) {
        const puppeteer = require('puppeteer-core')

        browser = await puppeteer.launch({
            headless: true,
            executablePath: '/usr/bin/chromium'
        })
    }
}

const puppeteerClose = async function () {
    if (browser) {
        await browser.close()
        browser = null
        authenticatedMarkets = {}
    }
}

const puppeteerPage = async function () {
    await puppeteerBrowser()
    const page = await browser.newPage()

    page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) {
            log(msg._text)
        }
    })

    return page
}

const Sync = {}

Sync.init = async function () {
    log('Sync.init()')

    // const worldData = JSON.parse(await fs.promises.readFile('./dev-data/br48/worldData.json'))
    // await inserWorldData(worldData, 'br', 48)

    process.on('SIGTERM', async function () {
        log('Stopping tw2tracker')
        process.exit()
    })

    const state = await db.one(sql.state.all)

    if (!state.last_fetch_markets_time) {
        await Sync.markets()
    }

    if (!state.last_register_worlds_time) {
        await Sync.registerWorlds()
    }

    if (!state.last_scrappe_all_time) {
        await Sync.scrappeAllWorlds()
    }

    try {
        await Sync.daemon()
    } catch (error) {
        log(colors.red(error.message))
    }
}

Sync.daemon = async function () {
    log()
    log('Sync.daemon()', log.INCREASE)

    const {
        scrappe_all_interval,
        register_worlds_interval,
        clean_shares_check_interval
    } = await db.one(sql.settings.intervals)

    const scrapeWorldsJob = schedule.scheduleJob(scrappe_all_interval, async function () {
        await Sync.scrappeAllWorlds()
        log('Next scrappeAllWorlds ' + colors.green(scrapeWorldsJob.nextInvocation()._date.fromNow()))
    })

    const registerWorldsJob = schedule.scheduleJob(register_worlds_interval, async function () {
        await Sync.markets()
        await Sync.registerWorlds()
        log('Next registerWorldsJob ' + colors.green(registerWorldsJob.nextInvocation()._date.fromNow()))
    })

    const cleanSharesJob = schedule.scheduleJob(clean_shares_check_interval, async function () {
        await Sync.cleanExpiredShares()
        log('Next cleanExpiredShares ' + colors.green(cleanSharesJob.nextInvocation()._date.fromNow()))
    })

    log('Next scrappeAllWorlds ' + colors.green(scrapeWorldsJob.nextInvocation()._date.fromNow()))
    log('Next registerWorldsJob ' + colors.green(registerWorldsJob.nextInvocation()._date.fromNow()))
    log('Next cleanExpiredShares ' + colors.green(cleanSharesJob.nextInvocation()._date.fromNow()), log.DECREASE)
}

Sync.registerWorlds = async function () {
    log()
    log('Sync.registerWorlds()', log.INCREASE)

    await db.query(sql.state.update.registerWorlds)

    let markets

    if (development) {
        markets = [
            { id: 'zz', account_name: 'tribalwarstracker', account_password: '7FONlraMpdnvrNIVE8aOgSGISVW00A' },
            { id: 'br', account_name: 'tribalwarstracker', account_password: '7FONlraMpdnvrNIVE8aOgSGISVW00A' }
        ]
    } else {
        markets = (await db.any(sql.markets.all)).filter(market => market.account_name && market.account_password)
    }

    for (let i = 0; i < markets.length; i++) {
        const market = markets[i]
        let account

        try {
            account = await Sync.auth(market.id, market)
        } catch (error) {
            log(colors.red(error.message))
            continue
        }

        const allowedLoginCharacters = account.characters.filter(world => world.allow_login)
        const nonFullWorlds = account.worlds.filter(world => !world.full)

        for (let world of nonFullWorlds) {
            await Sync.registerCharacter(market.id, utils.extractNumbers(world.world_id))
        }

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

        const allWorlds = [
            ...formatedAllowedLoginCharacters,
            ...formatedNonFullWorlds
        ]

        if (nonFullWorlds.length) {
            for (let {worldNumber} of Object.entries(formatedNonFullWorlds)) {
                await Sync.registerCharacter(market.id, worldNumber)
            }
        }

        for (let world of allWorlds) {
            const {worldNumber, worldName} = world

            const worldSchemaExists = await utils.schemaExists(market.id + worldNumber)
            const worldEntryExists = await utils.worldEntryExists(market.id, worldNumber)

            if (!worldSchemaExists || !worldEntryExists) {
                log('Creating world entry for', market.id + worldNumber)
            }

            if (!worldSchemaExists) {
                await db.query(sql.worlds.createSchema, {schema: market.id + worldNumber})
            }

            if (!worldEntryExists) {
                await db.query(sql.worlds.addEntry, [market.id, worldNumber, worldName, true])
            }
        }
    }

    log.decrease()
}

Sync.registerCharacter = async function (marketId, worldNumber) {
    log(`Sync.registerCharacter() ${marketId}${worldNumber}`, log.INCREASE)

    const page = await puppeteerPage()
    await page.goto(`https://${marketId}.tribalwars2.com/page`, {waitUntil: ['domcontentloaded', 'networkidle0']})
    await page.waitFor(2000)

    await page.evaluate(function (marketId, worldNumber) {
        return new Promise(function (resolve) {
            const socketService = injector.get('socketService')
            const routeProvider = injector.get('routeProvider')

            socketService.emit(routeProvider.CREATE_CHARACTER, {
                world: marketId + worldNumber
            }, resolve)
        })
    }, marketId, worldNumber)

    await page.waitFor(2000)
    await page.goto(`https://${marketId}.tribalwars2.com/page`, {waitUntil: ['domcontentloaded', 'networkidle0']})
    await page.waitFor(2000)

    log('Character created', log.DECREASE)
}

Sync.auth = async function (marketId, { account_name, account_password }, auth_attempt = 1) {
    log(`Sync.auth() market:${marketId}`)

    if (marketId in authenticatedMarkets && authenticatedMarkets[marketId].name === account_name) {
        return authenticatedMarkets[marketId]
    }

    const page = await puppeteerPage()

    try {
        const urlId = marketId === 'zz' ? 'beta' : marketId

        await page.goto(`https://${urlId}.tribalwars2.com/page`, { waitUntil: ['domcontentloaded', 'networkidle0'] })
        await page.waitFor(1000)

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
            const error = await page.$eval('.login-error .error-message', $elem => $elem.textContent)
            throw new Error(error)
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
            throw new Error(`Authentication to market:${marketId} failed "unknown reason"`)
        }

        await page.close()
        authenticatedMarkets[marketId] = account

        return account
    } catch (error) {
        await page.close()

        if (auth_attempt < 3) {
            auth_attempt++

            log(colors.red(`Error trying to auth (${error.message})`))

            return await Sync.auth(marketId, {
                account_name,
                account_password
            }, auth_attempt)
        } else {
            throw new Error(error.message)
        }
    }
}

Sync.scrappeAllWorlds = async function (flag) {
    log()
    log('Sync.scrappeAllWorlds()', log.INCREASE)

    if (fullSyncInProgress) {
        log(colors.red('A sync is already in progress'))
        logLevel--
        return false
    }

    fullSyncInProgress = true

    let worlds
    const failedToSync = []

    const perf = utils.perf(utils.perf.MINUTES)

    if (development) {
        worlds = [
            { market: 'zz', num: 8 },
            { market: 'br', num: 52 }
        ]
    } else {
        worlds = await db.any(sql.worlds.allOpen)
    }

    await db.query(sql.state.update.lastScrappeAll)

    await puppeteerBrowser()

    for (let world of worlds) {
        try {
            await Sync.scrappeWorld(world.market, world.num, flag)
        } catch (error) {
            log(colors.red(error.message))

            failedToSync.push({
                marketId: world.market,
                worldNumber: world.num,
                message: error.message
            })
        }
    }

    const time = perf.end()

    await puppeteerClose()

    fullSyncInProgress = false

    if (failedToSync.length) {
        if (failedToSync.length === worlds.length) {
            log(colors.red('All worlds failed to sync.'))
            log(`Finished in ${time}`, log.DECREASE)

            return ERROR_SYNC_ALL
        } else {
            log(colors.magenta('Some worlds failed to sync:'), log.INCREASE)

            for (let fail of failedToSync) {
                log(`${fail.marketId} ${fail.worldNumber}: ${fail.message}`)
            }

            log.decrease()
            log(`Finished in ${time}`, log.DECREASE)

            return ERROR_SYNC_SOME
        }
    } else {
        log(`Finished in ${time}`, log.DECREASE)

        return SUCCESS_SYNC_ALL
    }
}

const downloadStruct = async function (url, marketId, worldNumber) {
    const buffer = await utils.getBuffer(url)
    const gzipped = zlib.gzipSync(buffer)
    
    await fs.promises.mkdir(path.join('.', 'data', marketId + worldNumber), { recursive: true })
    await fs.promises.writeFile(path.join('.', 'data', marketId + worldNumber, 'struct'), gzipped)
}

Sync.scrappeWorld = async function (marketId, worldNumber, flag, attempt = 1) {
    log()
    log(`Sync.scrappeWorld() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''), log.INCREASE)

    const worldId = marketId + worldNumber

    let page

    try {
        const accountCredentials = await db.one(sql.markets.oneWithAccount, [marketId])

        let worldInfo

        try {
            worldInfo = await db.one(sql.worlds.one, [marketId, worldNumber])
        } catch (e) {
            throw new Error(`World ${worldId} not found.`)
        }

        if (!worldInfo.open) {
            throw new Error(`World ${worldId} is closed`)
        }

        if (flag !== IGNORE_LAST_SYNC && worldInfo.last_sync) {
            const minutesSinceLastSync = (Date.now() - worldInfo.last_sync.getTime()) / 1000 / 60
            const settings = await getSettings()

            if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
                throw new Error(`${worldId} already sincronized`)
            }
        }

        page = await puppeteerPage()

        const perf = utils.perf()

        const account = await Sync.auth(marketId, accountCredentials)
        const worldCharacter = account.characters.find(({ world_id }) => world_id === worldId)

        if (!worldCharacter) {
            await Sync.registerCharacter(marketId, worldNumber)
        } else if (!worldCharacter.allow_login) {
            await db.query(sql.worlds.lock, [marketId, worldNumber])
            throw new Error('world is not open')
        }

        const urlId = marketId === 'zz' ? 'beta' : marketId
        await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
        await page.evaluate(readyState)

        try {
            await fs.promises.access(path.join('.', 'data', worldId, 'struct'))
        } catch (e) {
            log('Downloading map structure')

            const structPath = await page.evaluate(function () {
                console.log('Scrapper: Loading structure binary')
                const cdn = require('cdn')
                const conf = require('conf/conf')
                return cdn.getPath(conf.getMapPath())
            })

            await downloadStruct(`https://${urlId}.tribalwars2.com/${structPath}`, marketId, worldNumber)
        }

        const evaluationExpire = setTimeout(async function () {
            await page.close()
            throw new Error('Scrappe evaluation timeout')
        }, 120000)

        const data = await page.evaluate(Scrapper)
        clearTimeout(evaluationExpire)
        await page.close()

        log(
            colors.green(data.villages.length), 'villages',
            colors.green(data.players.length), 'players',
            colors.green(data.tribes.length), 'tribes'
        )

        await queryData(data, marketId, worldNumber)
        await Sync.genWorldBlocks(marketId, worldNumber)
        await db.query(sql.worlds.updateSyncStatus, [SUCCESS, marketId, worldNumber])
        
        const time = perf.end()

        await db.query(sql.worlds.updateSync, [marketId, worldNumber])

        log(`Finished in ${time}`)
    } catch (error) {
        log(colors.red(`Failed to synchronize ${worldId}: ${error.message}`))
        await page.close()

        if (attempt < 3) {
            log.decrease()
            await Sync.scrappeWorld(marketId, worldNumber, flag, ++attempt)
            return
        } else {
            await db.query(sql.worlds.updateSyncStatus, [FAIL, marketId, worldNumber])
        }
    }

    log.decrease()
}

const queryData = async function (data, marketId, worldNumber) {
    const worldId = marketId + worldNumber

    log('Writing data to database...')

    const perf = utils.perf()

    for (let [tribe_id, tribe] of data.tribes) {
        await db.query(sql.worlds.insert.tribe, {worldId, tribe_id, ...tribe})

        const {
            best_rank,
            best_points,
            best_villages
        } = await db.any(sql.worlds.tribeBestValues, {
            worldId,
            tribe_id
        })

        if (!best_rank || tribe.rank > best_rank) {
            await db.query(sql.worlds.update.tribeBestRank, {
                worldId,
                rank: tribe.rank,
                tribe_id
            })
        }

        if (!best_points || tribe.points > best_points) {
            await db.query(sql.worlds.update.tribeBestPoints, {
                worldId,
                points: tribe.points,
                tribe_id
            })
        }

        if (!best_villages || tribe.villages > best_villages) {
            await db.query(sql.worlds.update.tribeBestVillages, {
                worldId,
                villages: tribe.villages,
                tribe_id
            })
        }
    }

    for (let [character_id, player] of data.players) {
        await db.query(sql.worlds.insert.player, {worldId, character_id, ...player})

        const {
            best_rank,
            best_points,
            best_villages
        } = await db.any(sql.worlds.playerBestValues, {
            worldId,
            character_id
        })

        if (!best_rank || player.rank > best_rank) {
            await db.query(sql.worlds.update.playerBestRank, {
                worldId,
                rank: player.rank,
                character_id
            })
        }

        if (!best_points || player.points > best_points) {
            await db.query(sql.worlds.update.playerBestPoints, {
                worldId,
                points: player.points,
                character_id
            })
        }

        if (!best_villages || player.villages > best_villages) {
            await db.query(sql.worlds.update.playerBestVillages, {
                worldId,
                villages: player.villages,
                character_id
            })
        }
    }

    for (let [province_name, province_id] of data.provinces) {
        await db.query(sql.worlds.insert.province, {
            worldId,
            province_id,
            province_name
        })
    }

    for (let [village_id, village] of data.villages) {
        await db.query(sql.worlds.insert.village, {worldId, village_id, ...village})
    }

    for (let [character_id, villages_id] of data.villagesByPlayer) {
        await db.query(sql.worlds.insert.playerVillages, {worldId, character_id, villages_id})
    }

    const time = perf.end()

    log(`........................... ${time}`)
}

Sync.markets = async function () {
    log('Sync.markets()')

    await db.query(sql.state.update.lastFetchMarkets)

    const storedMarkets = await db.map(sql.markets.all, [], market => market.id)
    const $portalBar = await utils.getHTML('https://tribalwars2.com/portal-bar/https/portal-bar.html')
    const $markets = $portalBar.querySelectorAll('.pb-lang-sec-options a')
    
    const marketList = $markets.map(function ($market) {
        const market = $market.attributes.href.split('//')[1].split('.')[0]
        return market === 'beta' ? 'zz' : market
    })

    const missingMarkets = marketList.filter(marketId => !storedMarkets.includes(marketId))

    for (let missingMarket of missingMarkets) {
        await db.query(sql.markets.add, missingMarket)
    }

    return missingMarkets
}

Sync.genWorldBlocks = async function (marketId, worldNumber) {
    const worldId = marketId + worldNumber

    const perf = utils.perf()

    try {
        const players = await db.any(sql.worlds.getData, { worldId, table: 'players' })
        const villages = await db.any(sql.worlds.getData, { worldId, table: 'villages' })
        const tribes = await db.any(sql.worlds.getData, { worldId, table: 'tribes' })
        const provinces = await db.any(sql.worlds.getData, { worldId, table: 'provinces' })

        const parsedPlayers = {}
        const parsedTribes = {}
        const continents = {}
        const parsedProvinces = []
        const tribeVillageCounter = {}

        const dataPath = path.join('.', 'data', worldId)

        await fs.promises.mkdir(dataPath, { recursive: true })

        for (let { id, name, tribe_id, points } of players) {
            parsedPlayers[id] = [name, tribe_id || 0, points, 0]
        }

        for (let village of villages) {
            let { id, x, y, name, points, character_id, province_id } = village

            if (character_id) {
                parsedPlayers[character_id][3]++
            }

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

            if (!hasOwn.call(continents, k)) {
                continents[k] = {}
            }

            if (!hasOwn.call(continents[k], x)) {
                continents[k][x] = {}
            }

            continents[k][x][y] = [id, name, points, character_id || 0, province_id]
        }

        for (let { id, tribe_id } of players) {
            if (tribe_id) {
                if (hasOwn.call(tribeVillageCounter, tribe_id)) {
                    tribeVillageCounter[tribe_id] += parsedPlayers[id][3]
                } else {
                    tribeVillageCounter[tribe_id] = parsedPlayers[id][3]
                }
            }
        }

        for (let k in continents) {
            const data = JSON.stringify(continents[k])
            await fs.promises.writeFile(path.join(dataPath, k), zlib.gzipSync(data))
        }

        for (let { id, name, tag, points } of tribes) {
            parsedTribes[id] = [name, tag, points, tribeVillageCounter[id]]
        }

        for (let { name } of provinces) {
            parsedProvinces.push(name)
        }

        const info = {
            players: parsedPlayers,
            tribes: parsedTribes,
            provinces: parsedProvinces
        }

        const gzippedInfo = zlib.gzipSync(JSON.stringify(info))
        await fs.promises.writeFile(path.join(dataPath, 'info'), gzippedInfo)
    } catch (error) {
        log.increase()
        log(colors.red(`Failed to write to filesystem: ${error.message}`), log.DECREASE)
    }

    const time = perf.end()

    log(`Writed data to filesystem in ${time}`)

    return false
}

Sync.cleanExpiredShares = async function () {
    const now = Date.now()
    const shares = await db.any(sql.maps.getShareLastAccess)
    let { static_share_expire_time } = await db.one(sql.settings.intervals)

    static_share_expire_time = static_share_expire_time * 60 * 1000

    for (let { share_id, last_access } of shares) {
        if (now - last_access.getTime() < static_share_expire_time) {
            await db.query(sql.maps.deleteStaticShare, [share_id])
        }
    }
}

module.exports = Sync
