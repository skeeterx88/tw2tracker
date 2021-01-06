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
const enums = require('./enums.js')
const auths = {}

let browser = null
let syncInProgress = false
let syncAllInProgress = false

const achievementCommitTypes = {
    ADD: 'add',
    UPDATE: 'update'
}

const devAccounts = [
    {id: 'zz', account_name: 'tribalwarstracker', account_password: '7FONlraMpdnvrNIVE8aOgSGISVW00A'},
    {id: 'br', account_name: 'tribalwarstracker', account_password: '7FONlraMpdnvrNIVE8aOgSGISVW00A'}
]

const Sync = {}

Sync.init = async function () {
    Events.on(enums.SCRAPPE_WORLD_START, function () {
        syncInProgress = true
    })

    Events.on(enums.SCRAPPE_WORLD_END, function () {
        syncInProgress = false
    })

    Events.on(enums.SCRAPPE_WORLD_START, function () {
        syncAllInProgress = true
    })

    Events.on(enums.SCRAPPE_WORLD_END, function () {
        syncAllInProgress = false
    })

    await fs.promises.mkdir('logs', {recursive: true})

    log(log.GENERAL, 'Sync.init()')

    process.on('SIGTERM', async function () {
        log(log.GENERAL, colors.red('Stopping tw2-tracker! Waiting pendent tasks...'))

        if (syncInProgress) {
            await Events.on(enums.SCRAPPE_WORLD_END)
        }

        if (browser) {
            await browser.close()
        }

        await db.$pool.end()

        process.exit(0)
    })

    await initPuppeteerBrowser()

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
        if (development) {
            // const worldNumber = 8
            // const marketId = 'zz'
            // const worldId = marketId + worldNumber
            // const data = JSON.parse(await fs.promises.readFile(path.join('.', 'data', `${worldId}.freeze.json`)))
            // await commitDataDatabase(data, worldId)
            // await commitDataFilesystem(worldId)
            // await db.query(sql.updateWorldSyncStatus, [SYNC_SUCCESS, marketId, worldNumber])
            // await db.query(sql.updateWorldSyncDate, [marketId, worldNumber])

            // const worldNumber = 52
            // const marketId = 'br'
            // const worldId = marketId + worldNumber
            // const achievements = JSON.parse(await fs.promises.readFile(path.join('.', 'data', `${worldId}-achievements.freeze.json`)))
            // await commitAchievementsDatabase(achievements, worldId)

            // await Sync.allWorlds()
            // await Sync.world('br', 54)
            // await Sync.worldAchievements('br', 54)
            // await Sync.registerWorlds()

            // await Sync.worldAchievements('br', 52)
            // await Sync.allWorldsAchievements()
        } else {
            await Sync.daemon()
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

    const scrapeAchievementsWorldsJob = schedule.scheduleJob(scrappe_achievements_all_interval, async function () {
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

                    await db.query(sql.createWorldSchema, {
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

    const page = await createPuppeteerPage(log.GENERAL)
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

            page = await createPuppeteerPage(log.GENERAL)
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
        if (page) {
            await page.close()
        }

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

    Events.trigger(enums.SCRAPPE_ALL_WORLD_START)

    const failedToSync = []
    const perf = utils.perf(utils.perf.MINUTES)

    let worlds

    if (development) {
        worlds = [
            {market: 'zz', num: 8},
            {market: 'br', num: 52}
        ]
    } else {
        worlds = await db.any(sql.getOpenWorlds)
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

    Events.trigger(enums.SCRAPPE_ALL_WORLD_END)

    if (failedToSync.length) {
        const allFail = failedToSync.length === worlds.length

        log(log.GENERAL)
        log(log.GENERAL, `${allFail ? 'All' : 'Some'} worlds failed to sync:`)
        log.increase(log.GENERAL)

        for (let fail of failedToSync) {
            log(log.GENERAL, (fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
        }

        log.decrease(log.GENERAL)
        log(log.GENERAL)
        log(log.GENERAL, `Finished in ${time}`)
        log.decrease(log.GENERAL)

        return allFail ? enums.SYNC_ERROR_ALL : enums.SYNC_ERROR_SOME
    } else {
        log(log.GENERAL)
        log(log.GENERAL, `Finished in ${time}`)
        log.decrease(log.GENERAL)

        return enums.SYNC_SUCCESS_ALL
    }
}

Sync.world = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    Events.trigger(enums.SCRAPPE_WORLD_START)

    log(log.GENERAL)
    log(log.GENERAL, `Sync.world() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))
    log.increase(log.GENERAL)

    let page

    try {
        const world = await getWorld(marketId, worldNumber)
        const credentials = await db.one(sql.markets.oneWithAccount, [marketId])

        if (flag !== enums.IGNORE_LAST_SYNC && world.last_sync) {
            const minutesSinceLastSync = (Date.now() - world.last_sync.getTime()) / 1000 / 60
            const settings = await getSettings()

            if (minutesSinceLastSync < settings.scrapper_interval_minutes) {
                throw new Error(`${worldId} already sincronized`)
            }
        }

        page = await createPuppeteerPage(log.GENERAL)

        const perf = utils.perf()

        const account = await Sync.auth(marketId, credentials)
        const worldCharacter = account.characters.find(({world_id}) => world_id === worldId)

        if (!worldCharacter) {
            await Sync.registerCharacter(marketId, worldNumber)
        } else if (!worldCharacter.allow_login) {
            await db.query(sql.closeWorld, [marketId, worldNumber])
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

        if (!world.config) {
            try {
                log(log.GENERAL, 'Scrapper: Fetching world config')

                const worldConfig = await page.evaluate(function () {
                    const modelDataService = injector.get('modelDataService')
                    const worldConfig = modelDataService.getWorldConfig().data
                    const filteredConfig = {}

                    const selecteConfig = [
                        'speed', 'victory_points', 'barbarian_point_limit', 'barbarian_spawn_rate',
                        'barbarize_inactive_percent', 'bathhouse', 'chapel_bonus', 'church',
                        'farm_rule', 'instant_recruit', 'language_selection', 'loyalty_after_conquer',
                        'mass_buildings', 'mass_recruiting', 'noob_protection_days', 'relocate_units',
                        'resource_deposits', 'second_village', 'tribe_member_limit', 'tribe_skills'
                    ]

                    for (let key of selecteConfig) {
                        filteredConfig[key] = worldConfig[key]
                    }

                    return filteredConfig
                })

                await db.none(sql.updateWorldConfig, {
                    worldId,
                    worldConfig
                })
            } catch (error) {
                log(log.GENERAL, colors.red(`Error trying to fetch world config: ${error.message}`))
            }
        }

        if (!world.time_offset) {
            try {
                log(log.GENERAL, 'Scrapper: Fetching world time offset')

                const timeOffset = await page.evaluate(function () {
                    return require('helper/time').getGameTimeOffset()
                })

                await db.none(sql.updateWorldTimeOffset, {
                    worldId,
                    timeOffset
                })
            } catch (error) {
                log(log.GENERAL, colors.red(`Error trying to fetch world time offset: ${error.message}`))
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
        await db.query(sql.updateWorldSyncStatus, [enums.SYNC_SUCCESS, marketId, worldNumber])
        await db.query(sql.updateWorldSyncDate, [marketId, worldNumber])

        const time = perf.end()

        log(log.GENERAL, `Finished in ${time}`)
        log.decrease(log.GENERAL)

        await page.close()

        Events.trigger(enums.SCRAPPE_WORLD_END)
    } catch (error) {
        log(log.GENERAL, colors.red(`Failed to synchronize ${worldId}: ${error.stack}`))
        log.decrease(log.GENERAL)

        if (page) {
            await page.close()
        }

        if (attempt < 3) {
            return await Sync.world(marketId, worldNumber, flag, ++attempt)
        } else {
            await db.query(sql.updateWorldSyncStatus, [enums.SYNC_FAIL, marketId, worldNumber])
            Events.trigger(enums.SCRAPPE_WORLD_END)

            throw new Error(error.message)
        }
    }
}

Sync.allWorldsAchievements = async function (flag) {
    // log(log.ACHIEVEMENTS)
    // log(log.ACHIEVEMENTS, 'Sync.allWorldsAchievements()')
    // log.increase(log.ACHIEVEMENTS)

    Events.trigger(enums.SCRAPPE_ACHIEVEMENT_ALL_WORLD_START)

    const simultaneousSyncs = 3
    const failedToSync = []
    // const perf = utils.perf(utils.perf.MINUTES)

    let queuedWorlds

    if (development) {
        queuedWorlds = [
            {market: 'zz', num: 8},
            {market: 'br', num: 52}
        ]
    } else {
        queuedWorlds = await db.any(sql.getOpenWorlds)
    }

    let runningSyncs = 0

    async function asynchronousSync () {
        while (queuedWorlds.length) {
            const world = queuedWorlds.shift()

            if (runningSyncs < simultaneousSyncs) {
                runningSyncs++

                Sync.worldAchievements(world.market, world.num, flag).catch(function (error) {
                    failedToSync.push({
                        marketId: world.market,
                        worldNumber: world.num,
                        message: error.message
                    })
                })
            } else {
                await Events.on(enums.SCRAPPE_ACHIEVEMENT_WORLD_END)
                runningSyncs--
            }
        }
    }

    await asynchronousSync()

    // const time = perf.end()

    Events.trigger(enums.SCRAPPE_ACHIEVEMENT_ALL_WORLD_END)

    if (failedToSync.length) {
        const allFail = failedToSync.length === queuedWorlds.length

        // log(log.ACHIEVEMENTS)
        // log(log.ACHIEVEMENTS, `${allFail ? 'All' : 'Some'} worlds achievements failed to sync:`)
        // log.increase(log.ACHIEVEMENTS)

        // for (let fail of failedToSync) {
        //     log(log.ACHIEVEMENTS, (fail.marketId + fail.worldNumber).padEnd(7), colors.red(fail.message))
        // }

        // log.decrease(log.ACHIEVEMENTS)
        // log(log.ACHIEVEMENTS)
        // log(log.ACHIEVEMENTS, `Finished in ${time}`)
        // log.decrease(log.ACHIEVEMENTS)

        return allFail ? enums.SYNC_ACHIEVEMENTS_ERROR_ALL : enums.SYNC_ACHIEVEMENTS_ERROR_SOME
    } else {
        // log(log.ACHIEVEMENTS)
        // log(log.ACHIEVEMENTS, `Finished in ${time}`)
        // log.decrease(log.ACHIEVEMENTS)

        return enums.SYNC_ACHIEVEMENTS_SUCCESS_ALL
    }
}

Sync.worldAchievements = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    Events.trigger(enums.SCRAPPE_ACHIEVEMENT_WORLD_START)

    // log(log.ACHIEVEMENTS)
    log(log.ACHIEVEMENTS, `Sync.worldAchievements() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))
    // log.increase(log.ACHIEVEMENTS)

    let page

    try {
        await getWorld(marketId, worldNumber)

        const credentials = await db.one(sql.markets.oneWithAccount, [marketId])

        page = await createPuppeteerPage(log.ACHIEVEMENTS)

        const perf = utils.perf()

        const account = await Sync.auth(marketId, credentials)
        const urlId = marketId === 'zz' ? 'beta' : marketId
        await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
        await page.evaluate(readyState)

        const achievements = await utils.timeout(async function () {
            return await page.evaluate(ScrapperAchievements, marketId, worldNumber)
        }, 1000000, 'ScrapperAchievements evaluation timeout')

        // // WRITE DATA TO FS SO IT CAN BE FAST-LOADED WITHOUT CALLING THE SYNC.
        // await fs.promises.writeFile(path.join('.', 'data', `${worldId}-achievements.freeze.json`), JSON.stringify(achievements))
        // return

        await commitAchievementsDatabase(achievements, worldId)

        const time = perf.end()

        log(log.ACHIEVEMENTS, `Sync.worldAchievements() ${colors.green(worldId)} finished in ${time}`)
        log.decrease(log.ACHIEVEMENTS)

        await page.close()

        Events.trigger(enums.SCRAPPE_ACHIEVEMENT_WORLD_END)
    } catch (error) {
        log(log.ACHIEVEMENTS, colors.red(`Sync.worldAchievements() ${colors.green(worldId)} failed: ${error.message}`))
        log.decrease(log.ACHIEVEMENTS)

        if (page) {
            await page.close()
        }

        if (attempt < 3) {
            return await Sync.worldAchievements(marketId, worldNumber, flag, ++attempt)
        } else {
            Events.trigger(enums.SCRAPPE_ACHIEVEMENT_WORLD_END)
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

async function commitDataDatabase (data, worldId) {
    const perf = utils.perf()

    await db.tx(async function () {
        const playersNew = new Map(data.players)
        const playersOld = new Map(await this.map(sql.worldPlayers, {worldId}, player => [player.id, player]))
        const tribesNew = new Map(data.tribes)
        const villagesNew = new Map(data.villages)
        const villagesNewIds = Array.from(villagesNew.keys())
        const villagesOld = new Map(await this.map(sql.worldVillages, {worldId}, village => [village.id, village]))
        const villagesOldIds = Array.from(villagesOld.keys())
        const missingVillagesIds = villagesNewIds.filter(villageId => !villagesOldIds.includes(villageId))

        const records = {
            tribes: new Map(await db.map(sql.getTribesRecords, {worldId}, (tribe) => [tribe.id, [tribe.best_rank, tribe.best_points, tribe.best_villages]])),
            players: new Map(await db.map(sql.getPlayersRecords, {worldId}, (player) => [player.id, [player.best_rank, player.best_points, player.best_villages]]))
        }

        const sqlSubjectMap = {
            players: {
                updateData: sql.updatePlayer,
                updateRecordRank: sql.updatePlayerRecordRank,
                updateRecordPoints: sql.updatePlayerRecordPoints,
                updateRecordVillages: sql.updatePlayerRecordVillages
            },
            tribes: {
                updateData: sql.updateTribe,
                updateRecordRank: sql.updateTribeRecordRank,
                updateRecordPoints: sql.updateTribeRecordPoints,
                updateRecordVillages: sql.updateTribeRecordVillages
            }
        }

        for (let type of ['tribes', 'players']) {
            for (let [id, subject] of data[type]) {
                this.none(sqlSubjectMap[type].updateData, {worldId, id, ...subject})

                const [best_rank, best_points, best_villages] = records[type].get(id) || []

                if (!best_rank || subject.rank <= best_rank) {
                    this.none(sqlSubjectMap[type].updateRecordRank, {worldId, rank: subject.rank, id})
                }

                if (!best_points || subject.points >= best_points) {
                    this.none(sqlSubjectMap[type].updateRecordPoints, {worldId, points: subject.points, id})
                }

                if (!best_villages || subject.villages >= best_villages) {
                    this.none(sqlSubjectMap[type].updateRecordVillages, {worldId, villages: subject.villages, id})
                }
            }
        }

        for (let [province_name, province_id] of data.provinces) {
            this.none(sql.addProvince, {worldId, province_id, province_name})
        }

        for (let [village_id, village] of data.villages) {
            this.none(sql.addVillage, {worldId, village_id, ...village})
        }

        for (let [village_id, village] of villagesNew.entries()) {
            const oldVillage = villagesOld.has(village_id)
                ? villagesOld.get(village_id)
                : {village_id, ...village}

            if (village.character_id !== oldVillage.character_id && village.character_id) {
                const newOwnerId = village.character_id
                const newOwner = playersNew.get(newOwnerId)
                const oldOwner = missingVillagesIds.includes(village_id) ? null : playersNew.get(oldVillage.character_id)
                const oldOwnerId = oldOwner ? oldVillage.character_id : null

                const tribeData = {
                    new_owner_tribe_id: null,
                    new_owner_tribe_tag_then: null,
                    old_owner_tribe_id: null,
                    old_owner_tribe_tag_then: null
                }

                if (newOwner.tribe_id) {
                    tribeData.new_owner_tribe_id = newOwner.tribe_id
                    tribeData.new_owner_tribe_tag_then = tribesNew.get(newOwner.tribe_id).tag
                }

                if (oldOwner && oldOwner.tribe_id) {
                    tribeData.old_owner_tribe_id = oldOwner.tribe_id
                    tribeData.old_owner_tribe_tag_then = tribesNew.get(oldOwner.tribe_id).tag
                }

                await this.none(sql.addConquest, {
                    worldId,
                    village_id,
                    newOwner: newOwnerId,
                    oldOwner: oldOwnerId,
                    village_points_then: village.points,
                    ...tribeData
                })
            }
        }

        for (let [character_id, playerNewData] of playersNew.entries()) {
            const playerOldData = playersOld.get(character_id)

            const oldTribeId = playerOldData ? playerOldData.tribe_id : null
            const newTribeId = playerNewData.tribe_id

            if (oldTribeId !== newTribeId) {
                const oldTribe = oldTribeId ? await this.one(sql.getTribe, {worldId, tribeId: oldTribeId}) : null
                const newTribe = newTribeId ? await this.one(sql.getTribe, {worldId, tribeId: newTribeId}) : null

                this.none(sql.addTribeMemberChange, {
                    worldId,
                    character_id,
                    old_tribe: oldTribeId,
                    new_tribe: newTribeId,
                    old_tribe_tag_then: oldTribe ? oldTribe.tag : null,
                    new_tribe_tag_then: newTribe ? newTribe.tag : null
                })
            }
        }

        for (let [character_id, villages_id] of data.villagesByPlayer) {
            this.none(sql.updatePlayerVillages, {worldId, character_id, villages_id})
        }

        this.none(sql.updateWorldStats, {
            worldId,
            villages: data.villages.length,
            players: data.players.length,
            tribes: data.tribes.length
        })
    })

    await db.query(sql.updateWorldStats, {
        worldId,
        villages: data.villages.length,
        players: data.players.length,
        tribes: data.tribes.length
    })

    const time = perf.end()

    log(log.GENERAL, `Writed data to database in ${time}`)
}

async function commitAchievementsDatabase (data, worldId) {
    const perf = utils.perf()

    const sqlSubjectMap = {
        players: {
            [achievementCommitTypes.ADD]: sql.addPlayerAchievement,
            [achievementCommitTypes.UPDATE]: sql.updatePlayerAchievement
        },
        tribes: {
            [achievementCommitTypes.ADD]: sql.addTribeAchievement,
            [achievementCommitTypes.UPDATE]: sql.updateTribeAchievement
        }
    }

    await db.tx(async function () {
        for (let subjectType of ['players', 'tribes']) {
            const modifiedAchievements = await getModifiedAchievements(subjectType, data[subjectType], worldId)

            for (let {commitType, achievement} of modifiedAchievements) {
                this.none(sqlSubjectMap[subjectType][commitType], {
                    worldId,
                    id: achievement.id,
                    type: achievement.type,
                    category: achievement.category,
                    level: achievement.level,
                    period: achievement.period || null,
                    time_last_level: achievement.time_last_level ? new Date(achievement.time_last_level * 1000) : null
                })
            }
        }
    })

    const time = perf.end()

    // log(log.ACHIEVEMENTS, `Writed achievements data to database in ${time}`)
}

async function commitDataFilesystem (worldId) {
    const perf = utils.perf()

    try {
        const players = await db.any(sql.getWorldData, {worldId, table: 'players'})
        const villages = await db.any(sql.getWorldData, {worldId, table: 'villages'})
        const tribes = await db.any(sql.getWorldData, {worldId, table: 'tribes'})
        const provinces = await db.any(sql.getWorldData, {worldId, table: 'provinces'})

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

async function initPuppeteerBrowser () {
    browser = await puppeteer.launch({headless: true, executablePath: '/usr/bin/chromium'})
}

async function createPuppeteerPage (logId) {
    const page = await browser.newPage()

    return page.on('console', function (msg) {
        if (msg._type === 'log' && msg._text.startsWith('Scrapper:')) log(logId, msg._text)
    })
}

async function getWorld (marketId, worldNumber) {
    let world

    try {
        world = await db.one(sql.getWorld, [marketId, worldNumber])
    } catch (e) {
        throw new Error(`World ${marketId + worldNumber} not found.`)
    }

    if (!world.open) {
        throw new Error(`World ${marketId + worldNumber} is closed`)
    }

    return world
}

async function getModifiedAchievements (subjectType, achievements, worldId) {
    const achievementsToCommit = []

    const sqlAchievementsMap = {
        players: sql.getPlayerAchievements,
        tribes: sql.getTribeAchievements
    }

    for (let [subjectId, newAchievementsRaw] of achievements) {
        const achievementsToMerge = []

        const oldAchievementsRaw = await db.any(sqlAchievementsMap[subjectType], {worldId, id: subjectId})

        if (oldAchievementsRaw.length) {
            const oldAchievements = mapAchievements(oldAchievementsRaw)
            const newAchievements = mapAchievements(newAchievementsRaw)

            const oldUniqueTypes = Object.keys(oldAchievements.unique)
            const newUniqueTypes = Object.keys(newAchievements.unique)

            if (newAchievementsRaw.length > oldAchievementsRaw.length) {
                const missingTypes = newUniqueTypes.filter(type => !oldUniqueTypes.includes(type))

                for (let type of missingTypes) {
                    achievementsToMerge.push({
                        commitType: achievementCommitTypes.ADD,
                        achievement: newAchievements.unique[type]
                    })
                }
            }

            for (let type of oldUniqueTypes) {
                if (newAchievements.unique[type].level > oldAchievements.unique[type].level) {
                    achievementsToMerge.push({
                        commitType: achievementCommitTypes.UPDATE,
                        achievement: newAchievements.unique[type]
                    })
                }
            }

            for (let type of Object.keys(newAchievements.repeatable)) {
                const newRepeatable = newAchievements.repeatable[type]
                const oldRepeatable = oldAchievements.repeatable[type]

                const merge = []

                if (!oldRepeatable) {
                    merge.push(...newRepeatable)
                } else if (oldRepeatable.length !== newRepeatable.length) {
                    merge.push(...newRepeatable.slice(oldRepeatable.length, newRepeatable.length))
                }

                achievementsToMerge.push(...merge.map(achievement => {
                    return {
                        commitType: achievementCommitTypes.ADD,
                        achievement
                    }
                }))
            }
        } else {
            achievementsToMerge.push(...newAchievementsRaw.map(achievement => {
                return {
                    commitType: achievementCommitTypes.ADD,
                    achievement
                }
            }))
        }

        const achievementsToMergeMap = achievementsToMerge.map(function (commit) {
            commit.achievement.id = subjectId
            return commit
        })

        achievementsToCommit.push(...achievementsToMergeMap)
    }

    return achievementsToCommit
}

function mapAchievements (achievements) {
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

async function downloadMapStruct (url, worldId) {
    const buffer = await utils.getBuffer(url)
    const gzipped = zlib.gzipSync(buffer)

    await fs.promises.mkdir(path.join('.', 'data', worldId), {recursive: true})
    await fs.promises.writeFile(path.join('.', 'data', worldId, 'struct'), gzipped)
}

module.exports = Sync
