const {db} = require('./db')
const sql = require('./sql')
const utils = require('./utils')
const {log, hasOwn} = utils
const Scrapper = require('./scrapper.js')
const ScrapperAchievements = require('./scrapper-achievements.js')
const readyState = require('./ready-state.js')
const getSettings = require('./settings')
const Events = require('./events.js')
const fs = require('fs')
const schedule = require('node-schedule')
const zlib = require('zlib')
const path = require('path')
const colors = require('colors/safe')
const development = process.env.NODE_ENV === 'development'
const puppeteer = require('puppeteer-core')

const auths = {}

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
    IGNORE_LAST_SYNC,
    SCRAPPE_ACHIEVEMENT_WORLD_START,
    SCRAPPE_ACHIEVEMENT_WORLD_END,
    SCRAPPE_ACHIEVEMENT_ALL_WORLD_START,
    SCRAPPE_ACHIEVEMENT_ALL_WORLD_END
} = require('./constants.js')

let syncInProgress = false
let syncAllInProgress = false
let syncAchievementInProgress = false
let syncAllAchievementInProgress = false

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

Events.on(SCRAPPE_ACHIEVEMENT_WORLD_START, function () {
    syncAchievementInProgress = true
})

Events.on(SCRAPPE_ACHIEVEMENT_WORLD_END, function () {
    syncAchievementInProgress = false
})

Events.on(SCRAPPE_ACHIEVEMENT_ALL_WORLD_START, function () {
    syncAllAchievementInProgress = true
})

Events.on(SCRAPPE_ACHIEVEMENT_ALL_WORLD_END, function () {
    syncAllAchievementInProgress = false
})

let browser = null

const initBrowser = async function () {
    browser = await puppeteer.launch({headless: true, executablePath: '/usr/bin/chromium'})
}

const puppeteerPage = async function (logId) {
    const page = await browser.newPage()

    return page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) log(logId, msg._text)
    })
}

const Sync = {}

Sync.init = async function () {
    await fs.promises.mkdir('logs', {recursive: true})

    log(log.GENERAL, 'Sync.init()')

    process.on('SIGTERM', async function () {
        log(log.GENERAL, colors.red('Stopping tw2-tracker! Waiting pendent tasks...'))

        if (syncInProgress) {
            await Events.on(SCRAPPE_WORLD_END)
        }

        if (browser) {
            await browser.close()
        }

        await db.$pool.end()

        process.exit(0)
    })

    await initBrowser()

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
            // const worldNumber = 8
            // const marketId = 'zz'
            // const worldId = marketId + worldNumber
            // const data = JSON.parse(await fs.promises.readFile(path.join('.', 'data', `${worldId}.freeze.json`)))
            // await commitDataDatabase(data, worldId)
            // await commitDataFilesystem(worldId)
            // await db.query(sql.worlds.updateSyncStatus, [SYNC_SUCCESS, marketId, worldNumber])        
            // await db.query(sql.worlds.updateSync, [marketId, worldNumber])

            // const worldNumber = 52
            // const marketId = 'br'
            // const worldId = marketId + worldNumber
            // const achievements = JSON.parse(await fs.promises.readFile(path.join('.', 'data', `${worldId}-achievements.freeze.json`)))
            // await commitAchievementsDatabase(achievements, worldId)

            // await Sync.allWorlds()
            // await Sync.world('br', 48)
            // await Sync.registerWorlds()
            
            // await Sync.worldAchievements('br', 48)
            // await Sync.allWorldsAchievements()
        }
    } catch (error) {
        log(log.GENERAL, colors.red(error))
    }
}

Sync.daemon = async function () {
    log(log.GENERAL)
    log(log.GENERAL, 'Sync.daemon()')
    log.increase(log.GENERAL)

    const {
        scrappe_all_interval,
        scrappe_achievements_all_interval,
        register_worlds_interval,
        clean_shares_check_interval
    } = await db.one(sql.settings.intervals)

    const scrapeWorldsJob = schedule.scheduleJob(scrappe_all_interval, async function () {
        await Sync.allWorlds()
        log(log.GENERAL, 'Next Sync.allWorlds', colors.green(scrapeWorldsJob.nextInvocation()._date.calendar()))
    })

    const scrapeAchievementsWorldsJob = schedule.scheduleJob(scrappe_all_interval, async function () {
        await Sync.allWorldsAchievements()
        log(log.GENERAL, 'Next Sync.allWorldsAchievements', colors.green(scrapeAchievementsWorldsJob.nextInvocation()._date.calendar()))
    })

    const registerWorldsJob = schedule.scheduleJob(register_worlds_interval, async function () {
        await Sync.markets()
        await Sync.registerWorlds()
        log(log.GENERAL, 'Next Sync.registerWorldsJob', colors.green(registerWorldsJob.nextInvocation()._date.calendar()))
    })

    const cleanSharesJob = schedule.scheduleJob(clean_shares_check_interval, async function () {
        await Sync.cleanExpiredShares()
        log(log.GENERAL, 'Next Sync.cleanExpiredShares', colors.green(cleanSharesJob.nextInvocation()._date.calendar()))
    })

    log(log.GENERAL, 'Next Sync.allWorlds', colors.green(scrapeWorldsJob.nextInvocation()._date.calendar()))
    log(log.GENERAL, 'Next Sync.allWorldsAchievements', colors.green(scrapeAchievementsWorldsJob.nextInvocation()._date.calendar()))
    log(log.GENERAL, 'Next Sync.registerWorldsJob', colors.green(registerWorldsJob.nextInvocation()._date.calendar()))
    log(log.GENERAL, 'Next Sync.cleanExpiredShares', colors.green(cleanSharesJob.nextInvocation()._date.calendar()))
    log.decrease(log.GENERAL)
}

Sync.registerWorlds = async function () {
    log(log.GENERAL)
    log(log.GENERAL, 'Sync.registerWorlds()')
    log.increase(log.GENERAL)

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

                if (!await utils.worldEntryExists(worldId)) {
                    log(log.GENERAL, `Creating world entry for ${worldId}`)

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
            log(log.GENERAL, colors.red(`Failed to register worlds on market ${marketId}: ${error.message}`))
        }
    }

    log.decrease(log.GENERAL)
}

Sync.registerCharacter = async function (marketId, worldNumber) {
    log(log.GENERAL, `Sync.registerCharacter() ${marketId}${worldNumber}`)
    log.increase(log.GENERAL)

    const page = await puppeteerPage(log.GENERAL)
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

    log(log.GENERAL, 'Character created')
    log.decrease(log.GENERAL)
}

Sync.auth = async function (marketId, {account_name, account_password}, auth_attempt = 1) {
    if (hasOwn.call(auths, marketId)) {
        return await auths[marketId]
    }

    log(log.GENERAL, `Sync.auth() market:${marketId}`)

    let page

    try {
        auths[marketId] = utils.timeout(async function () {
            const urlId = marketId === 'zz' ? 'beta' : marketId

            page = await puppeteerPage(log.GENERAL)
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

            await page.close()

            return account
        }, 60000, 'Auth took more than 1 minute')

        return await auths[marketId]
    } catch (error) {
        await page.close()

        if (auth_attempt < 3) {
            auth_attempt++

            log(log.GENERAL, colors.red(`Error trying to auth (${error.message})`))

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
    log(log.GENERAL)
    log(log.GENERAL, 'Sync.allWorlds()')
    log.increase(log.GENERAL)

    if (syncAllInProgress) {
        log(log.GENERAL, colors.red('\nA Scrappe All Worlds is already in progress\n'))
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

    Events.trigger(SCRAPPE_ALL_WORLD_END)

    if (failedToSync.length) {
        if (failedToSync.length === worlds.length) {
            log(log.GENERAL)
            log(log.GENERAL, 'All worlds failed to sync:')
            log.increase(log.GENERAL)

            for (let fail of failedToSync) {
                log(log.GENERAL, (fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
            }

            log.decrease(log.GENERAL)
            log(log.GENERAL)
            log(log.GENERAL, `Finished in ${time}`)
            log.decrease(log.GENERAL)

            return SYNC_ERROR_ALL
        } else {
            log(log.GENERAL)
            log(log.GENERAL, 'Some worlds failed to sync:')
            log.increase(log.GENERAL)

            for (let fail of failedToSync) {
                log(log.GENERAL, (fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
            }

            log.decrease(log.GENERAL)
            log(log.GENERAL)
            log(log.GENERAL, `Finished in ${time}`)
            log.decrease(log.GENERAL)

            return SYNC_ERROR_SOME
        }
    } else {
        log(log.GENERAL)
        log(log.GENERAL, `Finished in ${time}`)
        log.decrease(log.GENERAL)

        return SYNC_SUCCESS_ALL
    }
}

Sync.world = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    Events.trigger(SCRAPPE_WORLD_START)

    log(log.GENERAL)
    log(log.GENERAL, `Sync.world() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))
    log.increase(log.GENERAL)

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

        page = await puppeteerPage(log.GENERAL)

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
            log(log.GENERAL, 'Scrapper: Fetching map structure')

            const structPath = await page.evaluate(function () {
                const cdn = require('cdn')
                const conf = require('conf/conf')
                return cdn.getPath(conf.getMapPath())
            })

            await downloadMapStruct(`https://${urlId}.tribalwars2.com/${structPath}`, worldId)
        }

        if (!worldInfo.config) {
            try {
                log(log.GENERAL, 'Scrapper: Fetching world config')

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
                log(log.GENERAL, colors.red(`Error trying to fetch world config: ${error.message}`))
            }
        }

        const data = await utils.timeout(async function () {
            return await page.evaluate(Scrapper)
        }, 120000, 'Scrappe evaluation timeout')

        // // WRITE DATA TO FS SO IT CAN BE FAST-LOADED WITHOUT CALLING THE SYNC.
        // await fs.promises.writeFile(path.join('.', 'data', `${worldId}.freeze.json`), JSON.stringify(data))
        // return

        await commitDataDatabase(data, worldId)
        await commitDataFilesystem(worldId)
        await db.query(sql.worlds.updateSyncStatus, [SYNC_SUCCESS, marketId, worldNumber])        
        await db.query(sql.worlds.updateSync, [marketId, worldNumber])

        const time = perf.end()

        log(log.GENERAL, `Finished in ${time}`)
        log.decrease(log.GENERAL)

        await page.close()

        Events.trigger(SCRAPPE_WORLD_END)
    } catch (error) {
        log(log.GENERAL, colors.red(`Failed to synchronize ${worldId}: ${error.stack}`))
        log.decrease(log.GENERAL)

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

Sync.allWorldsAchievements = async function (flag) {
    log(log.ACHIEVEMENTS)
    log(log.ACHIEVEMENTS, 'Sync.allWorldsAchievements()')
    log.increase(log.ACHIEVEMENTS)

    Events.trigger(SCRAPPE_ACHIEVEMENT_ALL_WORLD_START)

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

    for (let world of worlds) {
        try {
            await Sync.worldAchievements(world.market, world.num, flag)
        } catch (error) {
            failedToSync.push({
                marketId: world.market,
                worldNumber: world.num,
                message: error.message
            })
        }
    }

    const time = perf.end()

    Events.trigger(SCRAPPE_ACHIEVEMENT_ALL_WORLD_END)

    if (failedToSync.length) {
        if (failedToSync.length === worlds.length) {
            log(log.ACHIEVEMENTS)
            log(log.ACHIEVEMENTS, 'All worlds achievements failed to sync:')
            log.increase(log.ACHIEVEMENTS)

            for (let fail of failedToSync) {
                log((fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
            }

            log.decrease(log.ACHIEVEMENTS)
            log(log.ACHIEVEMENTS)
            log(log.ACHIEVEMENTS, `Finished in ${time}`)
            log.decrease(log.ACHIEVEMENTS)

            return SYNC_ERROR_ALL
        } else {
            log(log.ACHIEVEMENTS)
            log(log.ACHIEVEMENTS, 'Some worlds achievements failed to sync:')
            log.increase(log.ACHIEVEMENTS)

            for (let fail of failedToSync) {
                log((fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
            }

            log.decrease(log.ACHIEVEMENTS)
            log(log.ACHIEVEMENTS)
            log(log.ACHIEVEMENTS, `Finished in ${time}`)
            log.decrease(log.ACHIEVEMENTS)

            return SYNC_ERROR_SOME
        }
    } else {
        log(log.ACHIEVEMENTS)
        log(log.ACHIEVEMENTS, `Finished in ${time}`)
        log.decrease(log.ACHIEVEMENTS)

        return SYNC_SUCCESS_ALL
    }
}

Sync.worldAchievements = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    Events.trigger(SCRAPPE_ACHIEVEMENT_WORLD_START)

    log(log.ACHIEVEMENTS)
    log(log.ACHIEVEMENTS, `Sync.worldAchievements() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))
    log.increase(log.ACHIEVEMENTS)

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

        page = await puppeteerPage(log.ACHIEVEMENTS)

        const perf = utils.perf()

        const account = await Sync.auth(marketId, accountCredentials)
        const urlId = marketId === 'zz' ? 'beta' : marketId
        await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
        await page.evaluate(readyState)

        const achievements = await utils.timeout(async function () {
            return await page.evaluate(ScrapperAchievements)
        }, 1000000, 'ScrapperAchievements evaluation timeout')

        // // WRITE DATA TO FS SO IT CAN BE FAST-LOADED WITHOUT CALLING THE SYNC.
        // await fs.promises.writeFile(path.join('.', 'data', `${worldId}-achievements.freeze.json`), JSON.stringify(achievements))
        // return

        await commitAchievementsDatabase(achievements, worldId)

        const time = perf.end()

        log(log.ACHIEVEMENTS, `Finished in ${time}`)
        log.decrease(log.ACHIEVEMENTS)

        await page.close()

        Events.trigger(SCRAPPE_ACHIEVEMENT_WORLD_END)
    } catch (error) {
        log(log.ACHIEVEMENTS, colors.red(`Failed to synchronize achievements ${worldId}: ${error.stack}`))
        log.decrease(log.ACHIEVEMENTS)

        if (page) {
            await page.close()
        }

        if (attempt < 3) {
            return await Sync.worldAchievements(marketId, worldNumber, flag, ++attempt)
        } else {
            Events.trigger(SCRAPPE_ACHIEVEMENT_WORLD_END)
            throw new Error(error.message)
        }
    }
}

Sync.markets = async function () {
    log(log.GENERAL, 'Sync.markets()')

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

            if (!best_rank || tribe.rank <= best_rank) {
                this.none(sql.worlds.update.tribeBestRank, {worldId, rank: tribe.rank, tribe_id})
            }
            
            if (!best_points || tribe.points >= best_points) {
                this.none(sql.worlds.update.tribeBestPoints, {worldId, points: tribe.points, tribe_id})
            }

            if (!best_villages || tribe.villages >= best_villages) {
                this.none(sql.worlds.update.tribeBestVillages, {worldId, villages: tribe.villages, tribe_id})
            }
        }

        for (let [character_id, player] of data.players) {
            this.none(sql.worlds.insert.player, {worldId, character_id, ...player})

            const [best_rank, best_points, best_villages] = playersBestValues.get(character_id) || []

            if (!best_rank || player.rank <= best_rank) {
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
        const oldPlayers = new Map(await this.map(sql.worlds.players, {worldId}, player => [player.id, player]))
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
                    new_owner_tribe_tag_then: null,
                    old_owner_tribe_id: null,
                    old_owner_tribe_tag_then: null
                }

                if (newOwner.tribe_id) {
                    tribeData.new_owner_tribe_id = newOwner.tribe_id
                    tribeData.new_owner_tribe_tag_then = currentTribes.get(newOwner.tribe_id).tag
                }

                if (oldOwner && oldOwner.tribe_id) {
                    tribeData.old_owner_tribe_id = oldOwner.tribe_id
                    tribeData.old_owner_tribe_tag_then = currentTribes.get(oldOwner.tribe_id).tag
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
                    village_points_then: village.points,
                    ...tribeData
                })
            }
        }

        for (let [character_id, playerCurrentData] of currentPlayers.entries()) {
            const playerOldData = oldPlayers.get(character_id)

            if (!playerOldData || playerCurrentData.tribe_id !== playerOldData.tribe_id) {
                let oldTribe = await this.any(sql.worlds.tribe, {worldId, tribeId: playerOldData.tribe_id})
                let newTribe = await this.any(sql.worlds.tribe, {worldId, tribeId: playerCurrentData.tribe_id})

                const data = {
                    character_id,
                    old_tribe: playerOldData.tribe_id,
                    new_tribe: playerCurrentData.tribe_id
                }

                data.old_tribe_tag_then = oldTribe.length ? oldTribe[0].tag : null
                data.new_tribe_tag_then = newTribe.length ? newTribe[0].tag : null

                this.none(sql.worlds.insert.tribeChange, {worldId, ...data})
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

    log(log.GENERAL, `Writed data to database in ${time}`)
}

const mapAchievements = function (achievements) {
    const unique = {}
    const repeatable = {}

    for (let achievement of achievements) {
        if (achievement.category === 'repeatable') {
            if (!hasOwn.call(repeatable, achievement.type)) {
                repeatable[achievement.type] = []
            }

            repeatable[achievement.type].push(achievement)
        } else {
            unique[achievement.type] = achievement
        }
    }

    return {unique, repeatable}
}

const getMissingAchievements = async function (achievementsType, achievements, worldId) {
    const achievementsToCommit = []

    for (let [id, newAchievementsRaw] of achievements) {
        let achievementsToMerge = []
        const oldAchievementsRaw = await db.any(sql.stats[achievementsType].achievements, {worldId, id})

        if (oldAchievementsRaw.length === newAchievementsRaw.length) {
            continue
        }

        if (oldAchievementsRaw.length) {
            const oldAchievements = mapAchievements(oldAchievementsRaw)
            const newAchievements = mapAchievements(newAchievementsRaw)

            for (let type of Object.keys(newAchievements.repeatable)) {
                const newRepeatable = newAchievements.repeatable[type]
                const oldRepeatable = oldAchievements.repeatable[type]

                if (!oldRepeatable) {
                    achievementsToMerge.push(...newRepeatable)
                } else if (oldRepeatable.length !== newRepeatable.length) {
                    achievementsToMerge.push(...newRepeatable.slice(oldRepeatable.length, newRepeatable.length))
                }
            }

            const oldUniqueTypes = Object.keys(oldAchievements.unique)
            const newUniqueTypes = Object.keys(newAchievements.unique)
            const missingTypes = newUniqueTypes.filter(type => !oldUniqueTypes.includes(type))

            for (let type of missingTypes) {
                achievementsToMerge.push(newAchievements.unique[type])
            }
        } else {
            achievementsToMerge.push(...newAchievementsRaw)
        }

        achievementsToMerge = achievementsToMerge.map(function (achievement) {
            achievement.id = id
            return achievement
        })

        achievementsToCommit.push(...achievementsToMerge)
    }

    return achievementsToCommit
}

const commitAchievementsDatabase = async function (data, worldId) {
    const perf = utils.perf()

    const newPlayersAchievements = await getMissingAchievements('players', data.playersAchievements, worldId)
    const newTribesAchievements = await getMissingAchievements('tribes', data.tribesAchievements, worldId)

    await db.tx(async function () {
        for (let achievement of newPlayersAchievements) {
            this.none(sql.worlds.insert.playerAchievements, {
                worldId,
                id: achievement.id,
                type: achievement.type,
                category: achievement.category,
                level: achievement.level,
                period: achievement.period || null,
                time_last_level: achievement.time_last_level ? new Date(achievement.time_last_level * 1000) : null
            })
        }

        for (let achievement of newTribesAchievements) {
            this.none(sql.worlds.insert.tribeAchievements, {
                worldId,
                id: achievement.id,
                type: achievement.type,
                category: achievement.category,
                level: achievement.level,
                period: achievement.period || null,
                time_last_level: achievement.time_last_level ? new Date(achievement.time_last_level * 1000) : null
            })
        }
    })

    const time = perf.end()

    log(log.ACHIEVEMENTS, `Writed achievements data to database in ${time}`)
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
        log.increase(log.GENERAL)
        log(log.GENERAL, colors.red(`Failed to write to filesystem: ${error.message}`))
        log.decrease(log.GENERAL)
    }

    const time = perf.end()

    log(log.GENERAL, `Writed data to filesystem in ${time}`)

    return false
}

module.exports = Sync
