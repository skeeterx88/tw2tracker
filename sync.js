const {db} = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const {log, worldEntryExists} = utils
const Scrapper = require('./scrapper.js')
const readyState = require('./ready-state.js')
const getSettings = require('./settings')
const Events = require('./events.js')
const fs = require('fs')
const schedule = require('node-schedule')
const zlib = require('zlib')
const path = require('path')
const hasOwn = Object.prototype.hasOwnProperty
const colors = require('colors/safe')
const development = process.env.NODE_ENV === 'development'
let authenticatedMarkets = {}

const devAccounts = [
    {id: 'zz', account_name: 'tribalwarstracker', account_password: '7FONlraMpdnvrNIVE8aOgSGISVW00A'},
    {id: 'br', account_name: 'tribalwarstracker', account_password: '7FONlraMpdnvrNIVE8aOgSGISVW00A'}
]

const {
    SYNC_SUCCESS,
    SYNC_FAIL,
    SYNC_SUCCESS_ALL,
    SYNC_ERROR_ALL,
    SYNC_ERROR_SOME,
    SCRAPPE_WORLD_START,
    SCRAPPE_WORLD_END,
    SCRAPPE_ALL_WORLD_START,
    SCRAPPE_ALL_WORLD_END,
    IGNORE_LAST_SYNC
} = require('./constants.js')

let syncInProgress = false
let syncAllInProgress = false

Events.on(SCRAPPE_WORLD_START, function () {
    syncInProgress = true
})

Events.on(SCRAPPE_WORLD_END, function () {
    syncInProgress = false
})

Events.on(SCRAPPE_WORLD_START, function () {
    syncAllInProgress = true
})

Events.on(SCRAPPE_WORLD_END, function () {
    syncAllInProgress = false
})

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

    process.on('SIGTERM', async function () {
        log(colors.red('Stopping tw2-tracker! Waiting pendent tasks...'))

        if (syncInProgress) {
            await Events.on(SCRAPPE_WORLD_END)
        }

        if (browser) {
            await browser.close()
        }

        await db.$pool.end()

        process.exit(0)
    })

    const state = await db.one(sql.state.all)

    if (!state.last_fetch_markets_time) {
        await Sync.markets()
    }

    if (!state.last_register_worlds_time) {
        await Sync.registerWorlds()
    }

    if (!state.last_scrappe_all_time) {
        await Sync.allWorlds()
    }

    try {
        if (!development) {
            await Sync.daemon()
        }

        if (development) {
            // // SKIP WORLD SYNC AND COMMIT "FAKE" DATA TO DB/FS.
            // const worldNumber = 52
            // const marketId = 'br'
            // const worldId = marketId + worldNumber
            // const data = JSON.parse(await fs.promises.readFile(path.join('.', 'data', `${worldId}.freeze.json`)))
            // await commitDataDatabase(data, worldId)
            // await commitDataFilesystem(worldId)
            // await db.query(sql.worlds.updateSyncStatus, [SYNC_SUCCESS, marketId, worldNumber])        
            // await db.query(sql.worlds.updateSync, [marketId, worldNumber])

            // await Sync.allWorlds()
            // await Sync.world('br', 52)
            // await Sync.registerWorlds()
        }
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
        await Sync.allWorlds()
        log('Next Sync.allWorlds', colors.green(scrapeWorldsJob.nextInvocation()._date.calendar()))
    })

    const registerWorldsJob = schedule.scheduleJob(register_worlds_interval, async function () {
        await Sync.markets()
        await Sync.registerWorlds()
        log('Next Sync.registerWorldsJob', colors.green(registerWorldsJob.nextInvocation()._date.calendar()))
    })

    const cleanSharesJob = schedule.scheduleJob(clean_shares_check_interval, async function () {
        await Sync.cleanExpiredShares()
        log('Next Sync.cleanExpiredShares', colors.green(cleanSharesJob.nextInvocation()._date.calendar()))
    })

    log('Next Sync.allWorlds', colors.green(scrapeWorldsJob.nextInvocation()._date.calendar()))
    log('Next Sync.registerWorldsJob', colors.green(registerWorldsJob.nextInvocation()._date.calendar()))
    log('Next Sync.cleanExpiredShares', colors.green(cleanSharesJob.nextInvocation()._date.calendar()), log.DECREASE)
}

Sync.registerWorlds = async function () {
    log()
    log('Sync.registerWorlds()', log.INCREASE)

    await db.query(sql.state.update.registerWorlds)
    const markets = development ? devAccounts : await db.any(sql.markets.withAccount)

    for (let market of markets) {
        const marketId = market.id

        try {
            const account = await Sync.auth(marketId, market)

            if (!account) {
                continue
            }

            const characters = account.characters
                .filter((world) => world.allow_login && world.character_id === account.player_id)
                .map(world => ({
                    worldNumber: utils.extractNumbers(world.world_id),
                    worldName: world.world_name,
                    registered: true
                }))

            const worlds = account.worlds
                .filter(world => !world.full)
                .map(world => ({
                    worldNumber: utils.extractNumbers(world.id),
                    worldName: world.name,
                    registered: false
                }))

            const allWorlds = [...worlds, ...characters]

            for (let world of allWorlds) {
                const {worldNumber, worldName, registered} = world
                const worldId = marketId + worldNumber

                if (!registered) {
                    await Sync.registerCharacter(marketId, worldNumber)
                }

                if (!await worldEntryExists(worldId)) {
                    log(`Creating world entry for ${worldId}`)

                    await db.query(sql.worlds.addEntry, {
                        worldId,
                        marketId,
                        worldNumber,
                        worldName,
                        open: true
                    })
                }
            }
        } catch (error) {
            log(colors.red(`Failed to register worlds on market ${marketId}: ${error.message}`))
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

Sync.auth = async function (marketId, {account_name, account_password}, auth_attempt = 1) {
    log(`Sync.auth() market:${marketId}`)

    if (marketId in authenticatedMarkets && authenticatedMarkets[marketId].name === account_name) {
        return authenticatedMarkets[marketId]
    }

    const page = await puppeteerPage()

    try {
        const account = await utils.timeout(async function () {
            const urlId = marketId === 'zz' ? 'beta' : marketId

            await page.goto(`https://${urlId}.tribalwars2.com/page`, {waitUntil: ['domcontentloaded', 'networkidle0']})
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

            await page.goto(`https://${urlId}.tribalwars2.com/page`, {waitUntil: ['domcontentloaded', 'networkidle0']})

            try {
                await page.waitForSelector('.player-worlds', {timeout: 3000})
            } catch (error) {
                throw new Error(`Authentication to market:${marketId} failed "unknown reason"`)
            }

            authenticatedMarkets[marketId] = account

            return account
        }, 60000, 'Auth took more than 1 minute')

        await page.close()

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

Sync.allWorlds = async function (flag) {
    log()
    log('Sync.allWorlds()', log.INCREASE)

    if (syncAllInProgress) {
        log(colors.red('\nA Scrappe All Worlds is already in progress\n'), log.ZERO)
        return false
    }

    Events.trigger(SCRAPPE_ALL_WORLD_START)

    const failedToSync = []
    const perf = utils.perf(utils.perf.MINUTES)

    let worlds

    if (development) {
        worlds = [
            {market: 'zz', num: 8},
            {market: 'br', num: 52}
        ]
    } else {
        worlds = await db.any(sql.worlds.allOpen)
    }

    await db.query(sql.state.update.lastScrappeAll)
    await puppeteerBrowser()

    for (let world of worlds) {
        try {
            await Sync.world(world.market, world.num, flag)
        } catch (error) {
            failedToSync.push({
                marketId: world.market,
                worldNumber: world.num,
                message: error.message
            })
        }
    }

    const time = perf.end()

    await puppeteerClose()

    Events.trigger(SCRAPPE_ALL_WORLD_END)

    if (failedToSync.length) {
        if (failedToSync.length === worlds.length) {
            log()
            log('All worlds failed to sync:')
            log.increase()

            for (let fail of failedToSync) {
                log((fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
            }

            log.decrease()
            log()
            log(`Finished in ${time}`)
            log.decrease()

            return SYNC_ERROR_ALL
        } else {
            log()
            log('Some worlds failed to sync:')
            log.increase()

            for (let fail of failedToSync) {
                log((fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
            }

            log.decrease()
            log()
            log(`Finished in ${time}`)
            log.decrease()

            return SYNC_ERROR_SOME
        }
    } else {
        log()
        log(`Finished in ${time}`)
        log.decrease()

        return SYNC_SUCCESS_ALL
    }
}

Sync.world = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    Events.trigger(SCRAPPE_WORLD_START)

    log()
    log(`Sync.world() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))
    log.increase()

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
        const worldCharacter = account.characters.find(({world_id}) => world_id === worldId)

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
            log('Scrapper: Fetching map structure')

            const structPath = await page.evaluate(function () {
                const cdn = require('cdn')
                const conf = require('conf/conf')
                return cdn.getPath(conf.getMapPath())
            })

            await downloadMapStruct(`https://${urlId}.tribalwars2.com/${structPath}`, worldId)
        }

        if (!worldInfo.config) {
            try {
                log('Scrapper: Fetching world config')

                const worldConfig = await page.evaluate(function () {
                    const modelDataService = injector.get('modelDataService')
                    const configs = modelDataService.getWorldConfig().data

                    return {
                        speed: configs.speed,
                        victory_points: configs.victory_points,
                        barbarian_point_limit: configs.barbarian_point_limit,
                        barbarian_spawn_rate: configs.barbarian_spawn_rate,
                        barbarize_inactive_percent: configs.barbarize_inactive_percent,
                        bathhouse: configs.bathhouse,
                        chapel_bonus: configs.chapel_bonus,
                        church: configs.church,
                        farm_rule: configs.farm_rule,
                        instant_recruit: configs.instant_recruit,
                        language_selection: configs.language_selection,
                        loyalty_after_conquer: configs.loyalty_after_conquer,
                        mass_buildings: configs.mass_buildings,
                        mass_recruiting: configs.mass_recruiting,
                        noob_protection_days: configs.noob_protection_days,
                        relocate_units: configs.relocate_units,
                        resource_deposits: configs.resource_deposits,
                        second_village: configs.second_village,
                        tribe_member_limit: configs.tribe_member_limit,
                        tribe_skills: configs.tribe_skills
                    }
                })

                await db.none(sql.worlds.insert.config, {
                    worldId,
                    worldConfig
                })
            } catch (error) {
                log(colors.red(`Error trying to fetch world config: ${error.message}`))
            }
        }

        const data = await utils.timeout(async function () {
            return await page.evaluate(Scrapper)
        }, 120000, 'Scrappe evaluation timeout')

        // // WRITE DATA TO FS SO IT CAN BE FAST-LOADED WITHOUT CALLING THE SYNC.
        // await fs.promises.writeFile(path.join('.', 'data', `${worldId}.freeze.json`), JSON.stringify(data))
        // process.exit()

        await commitDataDatabase(data, worldId)
        await commitDataFilesystem(worldId)
        await db.query(sql.worlds.updateSyncStatus, [SYNC_SUCCESS, marketId, worldNumber])        
        await db.query(sql.worlds.updateSync, [marketId, worldNumber])

        const time = perf.end()

        log(`Finished in ${time}`)
        log.decrease()

        await page.close()

        Events.trigger(SCRAPPE_WORLD_END)
    } catch (error) {
        log(colors.red(`Failed to synchronize ${worldId}: ${error.message}`))
        log.decrease()

        if (page) {
            await page.close()
        }

        if (attempt < 3) {
            return await Sync.world(marketId, worldNumber, flag, ++attempt)
        } else {
            await db.query(sql.worlds.updateSyncStatus, [SYNC_FAIL, marketId, worldNumber])
            Events.trigger(SCRAPPE_WORLD_END)

            throw new Error(error.message)
        }
    }
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

Sync.cleanExpiredShares = async function () {
    const now = Date.now()
    const shares = await db.any(sql.maps.getShareLastAccess)
    let {static_share_expire_time} = await db.one(sql.settings.intervals)

    static_share_expire_time = static_share_expire_time * 60 * 1000

    for (let {share_id, last_access} of shares) {
        if (now - last_access.getTime() < static_share_expire_time) {
            await db.query(sql.maps.deleteStaticShare, [share_id])
        }
    }
}

const downloadMapStruct = async function (url, worldId) {
    const buffer = await utils.getBuffer(url)
    const gzipped = zlib.gzipSync(buffer)

    await fs.promises.mkdir(path.join('.', 'data', worldId), {recursive: true})
    await fs.promises.writeFile(path.join('.', 'data', worldId, 'struct'), gzipped)
}

const commitDataDatabase = async function (data, worldId) {
    const perf = utils.perf()

    await db.tx(async function () {
        const tribesBestValues = new Map(await db.map(sql.worlds.tribesBestValues, {worldId}, (tribe) => [tribe.id, [tribe.best_rank, tribe.best_points, tribe.best_villages]]))
        const playersBestValues = new Map(await db.map(sql.worlds.playersBestValues, {worldId}, (player) => [player.id, [player.best_rank, player.best_points, player.best_villages]]))

        for (let [tribe_id, tribe] of data.tribes) {
            this.none(sql.worlds.insert.tribe, {worldId, tribe_id, ...tribe})

            const [best_rank, best_points, best_villages] = tribesBestValues.get(tribe_id) || []

            if (!best_rank || tribe.rank > best_rank) {
                this.none(sql.worlds.update.tribeBestRank, {worldId, rank: tribe.rank, tribe_id})
            }
            
            if (!best_points || tribe.points > best_points) {
                this.none(sql.worlds.update.tribeBestPoints, {worldId, points: tribe.points, tribe_id})
            }

            if (!best_villages || tribe.villages > best_villages) {
                this.none(sql.worlds.update.tribeBestVillages, {worldId, villages: tribe.villages, tribe_id})
            }
        }

        for (let [character_id, player] of data.players) {
            this.none(sql.worlds.insert.player, {worldId, character_id, ...player})

            const [best_rank, best_points, best_villages] = playersBestValues.get(character_id) || []

            if (!best_rank || player.rank >= best_rank) {
                this.none(sql.worlds.update.playerBestRank, {worldId, rank: player.rank, character_id})
            }

            if (!best_points || player.points >= best_points) {
                this.none(sql.worlds.update.playerBestPoints, {worldId, points: player.points, character_id})
            }

            if (!best_villages || player.villages >= best_villages) {
                this.none(sql.worlds.update.playerBestVillages, {worldId, villages: player.villages, character_id})
            }
        }

        for (let [province_name, province_id] of data.provinces) {
            this.none(sql.worlds.insert.province, {worldId, province_id, province_name})
        }

        const currentPlayers = new Map(data.players)
        const currentTribes = new Map(data.tribes)
        const currentVillages = new Map(data.villages)
        const currentVillagesId = Array.from(currentVillages.keys())
        const oldVillages = new Map(await this.map(sql.worlds.villages, {worldId}, village => [village.id, village]))
        const oldVillagesId = Array.from(oldVillages.keys())
        const newVillagesId = currentVillagesId.filter(villageId => !oldVillagesId.includes(villageId))

        for (let [village_id, village] of data.villages) {
            this.none(sql.worlds.insert.village, {worldId, village_id, ...village})
        }

        for (let [village_id, village] of currentVillages.entries()) {
            const oldVillage = oldVillages.has(village_id)
                ? oldVillages.get(village_id)
                : {village_id, ...village}

            if (village.character_id !== oldVillage.character_id && village.character_id) {
                const newOwnerId = village.character_id
                const newOwner = currentPlayers.get(newOwnerId)
                const oldOwner = newVillagesId.includes(village_id) ? null : currentPlayers.get(oldVillage.character_id)
                const oldOwnerId = oldOwner ? oldVillage.character_id : null

                const tribeData = {
                    new_owner_tribe_id: null,
                    new_owner_tribe_tag: null,
                    old_owner_tribe_id: null,
                    old_owner_tribe_tag: null
                }

                if (newOwner.tribe_id) {
                    tribeData.new_owner_tribe_id = newOwner.tribe_id
                    tribeData.new_owner_tribe_tag = currentTribes.get(newOwner.tribe_id).tag
                }

                if (oldOwner && oldOwner.tribe_id) {
                    tribeData.old_owner_tribe_id = oldOwner.tribe_id
                    tribeData.old_owner_tribe_tag = currentTribes.get(oldOwner.tribe_id).tag
                }

                // console.log('commit conquest', {
                //     worldId,
                //     village_id,
                //     newOwner: newOwnerId,
                //     oldOwner: oldOwnerId,
                //     ...tribeData
                // })

                await this.none(sql.worlds.insert.conquest, {
                    worldId,
                    village_id,
                    newOwner: newOwnerId,
                    oldOwner: oldOwnerId,
                    ...tribeData
                })
            }
        }

        for (let [character_id, villages_id] of data.villagesByPlayer) {
            this.none(sql.worlds.insert.playerVillages, {worldId, character_id, villages_id})
        }

        this.none(sql.worlds.update.stats, {
            worldId,
            villages: data.villages.length,
            players: data.players.length,
            tribes: data.tribes.length
        })

        return
    })

    await db.query(sql.worlds.update.stats, {
        worldId,
        villages: data.villages.length,
        players: data.players.length,
        tribes: data.tribes.length
    })

    const time = perf.end()

    log(`Writed data to database in ${time}`)
}

const commitDataFilesystem = async function (worldId) {
    const perf = utils.perf()

    try {
        const players = await db.any(sql.worlds.getData, {worldId, table: 'players'})
        const villages = await db.any(sql.worlds.getData, {worldId, table: 'villages'})
        const tribes = await db.any(sql.worlds.getData, {worldId, table: 'tribes'})
        const provinces = await db.any(sql.worlds.getData, {worldId, table: 'provinces'})

        const parsedPlayers = {}
        const parsedTribes = {}
        const continents = {}
        const parsedProvinces = []

        const dataPath = path.join('.', 'data', worldId)

        await fs.promises.mkdir(dataPath, {recursive: true})

        for (let {id, name, tribe_id, points, villages} of players) {
            parsedPlayers[id] = [name, tribe_id || 0, points, villages]
        }

        for (let village of villages) {
            let {id, x, y, name, points, character_id, province_id} = village

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

        for (let k in continents) {
            const data = JSON.stringify(continents[k])
            await fs.promises.writeFile(path.join(dataPath, k), zlib.gzipSync(data))
        }

        for (let {id, name, tag, points, villages} of tribes) {
            parsedTribes[id] = [name, tag, points, villages]
        }

        for (let {name} of provinces) {
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

module.exports = Sync
