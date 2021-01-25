const fs = require('fs')
const zlib = require('zlib')
const path = require('path')
const colors = require('colors/safe')
const WebSocket = require('ws')
const humanInterval = require('human-interval')
const debug = require('debug')
const debugSync = debug('tw2tracker:sync')
const debugTasks = debug('tw2tracker:tasks')

const db = require('./db.js')
const sql = require('./sql.js')
const puppeteer = require('./puppeteer.js')
const utils = require('./utils.js')
const config = require('./config.js')
const Events = require('./events.js')
const enums = require('./enums.js')

const scraperData = require('./scraper-data.js')
const scraperAchievements = require('./scraper-achievements.js')
const scraperReadyState = require('./scraper-ready-state.js')

const auths = {}
const Sync = {}

let syncSocketServer = null
let browser = null

const syncDataActiveWorlds = new Set()
const syncAchievementsActiveWorlds = new Set()
let syncDataAllRunning = false
let syncAchievementsAllRunning = false

Sync.init = async function () {
    debugSync('Sync.init()')

    Events.on(enums.SYNC_DATA_START, (worldId) => syncDataActiveWorlds.add(worldId))
    Events.on(enums.SYNC_DATA_FINISH, (worldId) => syncDataActiveWorlds.delete(worldId))
    Events.on(enums.SYNC_DATA_ALL_START, () => syncDataAllRunning = true)
    Events.on(enums.SYNC_DATA_ALL_FINISH, () => syncDataAllRunning = false)
    Events.on(enums.SYNC_ACHIEVEMENTS_START, (worldId) => syncAchievementsActiveWorlds.add(worldId))
    Events.on(enums.SYNC_ACHIEVEMENTS_FINISH, (worldId) => syncAchievementsActiveWorlds.delete(worldId))
    Events.on(enums.SYNC_ACHIEVEMENTS_ALL_START, () => syncAchievementsAllRunning = true)
    Events.on(enums.SYNC_ACHIEVEMENTS_ALL_FINISH, () => syncAchievementsAllRunning = false)

    process.on('SIGTERM', async function () {
        await db.$pool.end()
        process.exit(0)
    })

    initSyncSocketServer()

    const appState = await db.one(sql.getProgramState)

    if (appState.first_run) {
        await Sync.markets()
        await Sync.worlds()
        await Sync.dataAll()

        await db.query(sql.updateProgramState, {
            column: 'first_run',
            value: false
        })
    }

    const taskHandlers = new Map()

    taskHandlers.set('data_all', function () {
        Sync.dataAll()
    })

    taskHandlers.set('achievements_all', function () {
        Sync.achievementsAll()
    })

    taskHandlers.set('worlds', async function () {
        await Sync.markets()
        await Sync.worlds()
    })

    taskHandlers.set('clean_shares', async function () {
        const now = Date.now()
        const shares = await db.any(sql.maps.getShareLastAccess)
        const expireTime = humanInterval(config.sync.static_share_expire_time)

        for (const {share_id, last_access} of shares) {
            if (now - last_access.getTime() < expireTime) {
                await db.query(sql.maps.deleteStaticShare, [share_id])
            }
        }
    })

    const intervals = getTasksInterval()

    setInterval(async function () {
        const lastRuns = await getTasksLastRun()

        for (const [id, handler] of taskHandlers.entries()) {
            const interval = intervals.get(id)
            const lastRun = lastRuns.get(id)
            const elapsedTime = timeSince(lastRun)

            if (!lastRun || elapsedTime > interval) {
                handler()
                db.query(sql.updateTaskLastRun, {id})
            }
        }
    }, humanInterval('1 minute'))
}

Sync.data = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    if (syncDataActiveWorlds.has(worldId)) {
        return debugSync(`Sync.data() ${colors.green(marketId + worldNumber)} already in progress`)
    }

    Events.trigger(enums.SYNC_DATA_START, [worldId])

    debugSync(`Sync.data() ${colors.green(marketId + worldNumber)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))

    let page

    try {
        const world = await getWorld(marketId, worldNumber)
        const credentials = await db.one(sql.markets.oneWithAccount, [marketId])

        if (flag !== enums.IGNORE_LAST_SYNC && world.last_sync) {
            const minutesSinceLastSync = (Date.now() - world.last_sync.getTime()) / 1000 / 60
            if (minutesSinceLastSync < config.scraper_interval_minutes) {
                throw new Error(`${worldId} already sincronized`)
            }
        }

        page = await createPuppeteerPage()

        const account = await Sync.auth(marketId, credentials)
        const worldCharacter = account.characters.find(({world_id}) => world_id === worldId)

        if (!worldCharacter) {
            await Sync.character(marketId, worldNumber)
        } else if (!worldCharacter.allow_login) {
            await db.query(sql.closeWorld, [marketId, worldNumber])
            throw new Error('world is not open')
        }

        const urlId = marketId === 'zz' ? 'beta' : marketId
        await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
        await page.evaluate(scraperReadyState)

        if (!fs.existsSync(path.join('.', 'data', worldId, 'struct'))) {
            await fetchWorldMapStructure(page, worldId, urlId)
        }

        if (!world.config) {
            await fetchWorldConfig(page, worldId)
        }

        if (world.time_offset === null) {
            await fetchWorldTimeOffset(page, worldId)
        }

        const data = await utils.timeout(async function () {
            return await page.evaluate(scraperData)
        }, 120000, 'Scrape evaluation timeout')

        await commitRawDataFilesystem(data, worldId)
        await commitDataDatabase(data, worldId)
        await commitDataFilesystem(worldId)
        await db.query(sql.updateDataSync, [enums.SYNC_SUCCESS, marketId, worldNumber])

        const {last_data_sync_date} = await db.one(sql.getWorldSyncData, [marketId, worldNumber])
        const syncDate = utils.ejsHelpers.formatDate(last_data_sync_date)

        await page.close()

        Events.trigger(enums.SYNC_DATA_FINISH, [worldId, enums.SYNC_SUCCESS, syncDate])
    } catch (error) {
        debugSync(colors.red(`Failed to synchronize ${worldId}: ${error.message}`))

        syncDataActiveWorlds.delete(worldId)

        if (page) {
            await page.close()
        }

        if (attempt < 3) {
            return await Sync.data(marketId, worldNumber, flag, ++attempt)
        } else {
            await db.query(sql.updateDataSync, [enums.SYNC_FAIL, marketId, worldNumber])

            const {last_data_sync_date} = await db.one(sql.getWorldSyncData, [marketId, worldNumber])
            const syncDate = utils.ejsHelpers.formatDate(last_data_sync_date)

            Events.trigger(enums.SYNC_DATA_FINISH, [worldId, enums.SYNC_FAIL, syncDate])

            throw new Error(error.message)
        }
    }
}

Sync.achievements = async function (marketId, worldNumber, flag, attempt = 1) {
    const worldId = marketId + worldNumber

    if (syncAchievementsActiveWorlds.has(worldId)) {
        return debugSync(`Sync.achievements() ${colors.green(marketId + worldNumber)} already in progress`)
    } 

    debugSync(`Sync.achievements() ${colors.green(worldId)}`, colors.magenta(attempt > 1 ? `(attempt ${attempt})` : ''))
    Events.trigger(enums.SYNC_ACHIEVEMENTS_START, [worldId])

    let page

    try {
        await getWorld(marketId, worldNumber)

        const credentials = await db.one(sql.markets.oneWithAccount, [marketId])

        page = await createPuppeteerPage()

        const account = await Sync.auth(marketId, credentials)
        const urlId = marketId === 'zz' ? 'beta' : marketId
        await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']})
        await page.evaluate(scraperReadyState)

        const achievements = await utils.timeout(async function () {
            return await page.evaluate(scraperAchievements, marketId, worldNumber)
        }, 1000000, 'scraperAchievements evaluation timeout')

        await commitRawAchievementsFilesystem(achievements, worldId)
        await commitAchievementsDatabase(achievements, worldId)
        await db.query(sql.updateAchievementsSync, [enums.SYNC_SUCCESS, marketId, worldNumber])

        const {last_achievements_sync_date} = await db.one(sql.getWorldSyncAchievements, [marketId, worldNumber])
        const syncDate = utils.ejsHelpers.formatDate(last_achievements_sync_date)

        await page.close()

        Events.trigger(enums.SYNC_ACHIEVEMENTS_FINISH, [worldId, enums.SYNC_SUCCESS, syncDate])
    } catch (error) {
        debugSync(colors.red(`Sync.achievements() ${colors.green(worldId)} failed: ${error.message}`))

        syncAchievementsActiveWorlds.delete(worldId)

        if (page) {
            await page.close()
        }

        if (attempt < 3) {
            return await Sync.achievements(marketId, worldNumber, flag, ++attempt)
        } else {
            await db.query(sql.updateAchievementsSync, [enums.SYNC_FAIL, marketId, worldNumber])

            const {last_achievements_sync_date} = await db.one(sql.getWorldSyncAchievements, [marketId, worldNumber])
            const syncDate = utils.ejsHelpers.formatDate(last_achievements_sync_date)

            Events.trigger(enums.SYNC_ACHIEVEMENTS_FINISH, [worldId, enums.SYNC_FAIL, syncDate])

            throw new Error(error.message)
        }
    }
}

Sync.dataAll = async function (flag) {
    debugSync('Sync.dataAll()')

    if (syncDataAllRunning) {
        return debugSync(colors.red('Sync all data is already in progress'))
    }

    Events.trigger(enums.SYNC_DATA_ALL_START)

    async function asynchronousSync () {
        const queue = await db.any(sql.getOpenWorlds)
        const fails = []
        let running = 0

        while (queue.length) {
            if (running < config.sync.parallel_data_sync) {
                const world = queue.shift()

                running++

                Sync.data(world.market, world.num, flag).catch(function (error) {
                    fails.push({
                        marketId: world.market,
                        worldNumber: world.num,
                        message: error.message
                    })
                })
            } else {
                await Events.on(enums.SYNC_DATA_FINISH)
                running--
            }
        }

        return fails
    }

    Events.trigger(enums.SYNC_DATA_ALL_FINISH, await asynchronousSync())
}

Sync.achievementsAll = async function (flag) {
    debugSync('Sync.achievementsAll()')

    if (syncAchievementsAllRunning) {
        return debugSync(colors.red('Sync all achievements is already in progress'))
    }

    Events.trigger(enums.SYNC_ACHIEVEMENTS_ALL_START)

    async function asynchronousSync () {
        const queue = await db.any(sql.getOpenWorlds)
        const fails = []
        let running = 0

        while (queue.length) {
            if (running < config.sync.parallel_achievements_sync) {
                const world = queue.shift()

                running++

                Sync.achievements(world.market, world.num, flag).catch(function (error) {
                    fails.push({
                        marketId: world.market,
                        worldNumber: world.num,
                        message: error.message
                    })
                })
            } else {
                await Events.on(enums.SYNC_ACHIEVEMENTS_FINISH)
                running--
            }
        }

        return fails
    }

    Events.trigger(enums.SYNC_ACHIEVEMENTS_ALL_FINISH, await asynchronousSync())
}

Sync.worlds = async function () {
    debugSync('Sync.worlds()')

    const markets = await db.any(sql.markets.withAccount)

    for (const market of markets) {
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

            for (const world of allWorlds) {
                const {worldNumber, worldName, registered} = world
                const worldId = marketId + worldNumber

                if (!registered) {
                    await Sync.character(marketId, worldNumber)
                }

                if (!await utils.worldEntryExists(worldId)) {
                    debugSync(`Creating world entry for ${worldId}`)

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
            debugSync(colors.red(`Failed to register worlds on market ${marketId}: ${error.message}`))
        }
    }
}

Sync.markets = async function () {
    debugSync('Sync.markets()')

    const storedMarkets = await db.map(sql.markets.all, [], market => market.id)
    const $portalBar = await utils.getHTML('https://tribalwars2.com/portal-bar/https/portal-bar.html')
    const $markets = $portalBar.querySelectorAll('.pb-lang-sec-options a')

    const marketList = $markets.map(function ($market) {
        const market = $market.attributes.href.split('//')[1].split('.')[0]
        return market === 'beta' ? 'zz' : market
    })

    const missingMarkets = marketList.filter(marketId => !storedMarkets.includes(marketId))

    for (const missingMarket of missingMarkets) {
        await db.query(sql.markets.add, missingMarket)
    }

    return missingMarkets
}

Sync.character = async function (marketId, worldNumber) {
    debugSync(`Sync.character() ${marketId}${worldNumber}`)

    const page = await createPuppeteerPage()
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
}

Sync.auth = async function (marketId, {account_name, account_password}, auth_attempt = 1) {
    if (utils.hasOwn(auths, marketId)) {
        return await auths[marketId]
    }

    debugSync(`Sync.auth() market:${marketId}`)

    let page

    try {
        auths[marketId] = utils.timeout(async function () {
            const urlId = marketId === 'zz' ? 'beta' : marketId

            page = await createPuppeteerPage()
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

            debugSync(colors.red(`Error trying to auth (${error.message})`))

            return await Sync.auth(marketId, {
                account_name,
                account_password
            }, auth_attempt)
        } else {
            throw new Error(error.message)
        }
    }
}

async function commitDataDatabase (data, worldId) {
    await db.tx(async function () {
        const playersNew = new Map(data.players)
        const playersNewIds = Array.from(playersNew.keys())
        const playersOld = new Map(await this.map(sql.worldActivePlayers, {worldId}, player => [player.id, player]))
        const playersOldIds = Array.from(playersOld.keys())
        const missingPlayersIds = playersOldIds.filter(tribeId => !playersNewIds.includes(tribeId))

        const tribesNew = new Map(data.tribes)
        const tribesNewIds = Array.from(tribesNew.keys())
        const tribesOld = new Map(await this.map(sql.worldActiveTribes, {worldId}, tribe => [tribe.id, tribe]))
        const tribesOldIds = Array.from(tribesOld.keys())
        const missingTribesIds = tribesOldIds.filter(tribeId => !tribesNewIds.includes(tribeId))

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

        for (const id of missingPlayersIds) {
            await this.none(sql.archivePlayer, {worldId, id})
        }

        for (const id of missingTribesIds) {
            await this.none(sql.archiveTribe, {worldId, id})
        }

        for (const type of ['tribes', 'players']) {
            for (const [id, subject] of data[type]) {
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

        for (const [province_name, province_id] of data.provinces) {
            this.none(sql.addProvince, {worldId, province_id, province_name})
        }

        for (const [village_id, village] of data.villages) {
            this.none(sql.addVillage, {worldId, village_id, ...village})
        }

        for (const [village_id, village] of villagesNew.entries()) {
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

        for (const [character_id, playerNewData] of playersNew.entries()) {
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

        for (const [character_id, villages_id] of data.villagesByPlayer) {
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
}

async function commitAchievementsDatabase (data, worldId) {
    const sqlSubjectMap = {
        players: {
            [enums.achievementCommitTypes.ADD]: sql.addPlayerAchievement,
            [enums.achievementCommitTypes.UPDATE]: sql.updatePlayerAchievement
        },
        tribes: {
            [enums.achievementCommitTypes.ADD]: sql.addTribeAchievement,
            [enums.achievementCommitTypes.UPDATE]: sql.updateTribeAchievement
        }
    }

    await db.tx(async function () {
        for (const subjectType of ['players', 'tribes']) {
            const modifiedAchievements = await getModifiedAchievements(subjectType, data[subjectType], worldId)

            for (const {commitType, achievement} of modifiedAchievements) {
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
}

async function commitDataFilesystem (worldId) {
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

        for (const {id, name, tribe_id, points, villages} of players) {
            parsedPlayers[id] = [name, tribe_id || 0, points, villages]
        }

        for (const village of villages) {
            const {id, x, y, name, points, character_id, province_id} = village

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

            if (!utils.hasOwn(continents, k)) {
                continents[k] = {}
            }

            if (!utils.hasOwn(continents[k], x)) {
                continents[k][x] = {}
            }

            continents[k][x][y] = [id, name, points, character_id || 0, province_id]
        }

        for (const k in continents) {
            const data = JSON.stringify(continents[k])
            await fs.promises.writeFile(path.join(dataPath, k), zlib.gzipSync(data))
        }

        for (const {id, name, tag, points, villages} of tribes) {
            parsedTribes[id] = [name, tag, points, villages]
        }

        for (const {name} of provinces) {
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
        debugSync(colors.red(`Failed to write ${worldId} data to filesystem: ${error.message}`))
    }

    return false
}

async function commitRawDataFilesystem (data, worldId) {
    const location = path.join('.', 'data', 'raw')
    await fs.promises.mkdir(location, {recursive: true})
    await fs.promises.writeFile(path.join(location, `${worldId}.json`), JSON.stringify(data))
}

async function commitRawAchievementsFilesystem (achievements, worldId) {
    const location = path.join('.', 'data', 'raw')
    await fs.promises.mkdir(location, {recursive: true})
    await fs.promises.writeFile(path.join(location, `${worldId}-achievements.json`), JSON.stringify(achievements))
}

async function createPuppeteerPage () {
    if (!browser) {
        browser = await puppeteer()
    }

    const page = await browser.newPage()

    return page.on('console', function ({_type, _text}) {
        if (_type === 'log' && _text.startsWith('Sync:')) {
            debugSync(_text.replace('Sync:', ''))
        }
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

    for (const [subjectId, newAchievementsRaw] of achievements) {
        const achievementsToMerge = []

        const oldAchievementsRaw = await db.any(sqlAchievementsMap[subjectType], {worldId, id: subjectId})

        if (oldAchievementsRaw.length) {
            const oldAchievements = mapAchievements(oldAchievementsRaw)
            const newAchievements = mapAchievements(newAchievementsRaw)

            const oldUniqueTypes = Object.keys(oldAchievements.unique)
            const newUniqueTypes = Object.keys(newAchievements.unique)

            if (newAchievementsRaw.length > oldAchievementsRaw.length) {
                const missingTypes = newUniqueTypes.filter(type => !oldUniqueTypes.includes(type))

                for (const type of missingTypes) {
                    achievementsToMerge.push({
                        commitType: enums.achievementCommitTypes.ADD,
                        achievement: newAchievements.unique[type]
                    })
                }
            }

            for (const type of oldUniqueTypes) {
                if (newAchievements.unique[type].level > oldAchievements.unique[type].level) {
                    achievementsToMerge.push({
                        commitType: enums.achievementCommitTypes.UPDATE,
                        achievement: newAchievements.unique[type]
                    })
                }
            }

            for (const type of Object.keys(newAchievements.repeatable)) {
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
                        commitType: enums.achievementCommitTypes.ADD,
                        achievement
                    }
                }))
            }
        } else {
            achievementsToMerge.push(...newAchievementsRaw.map(achievement => {
                return {
                    commitType: enums.achievementCommitTypes.ADD,
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

    for (const achievement of achievements) {
        if (achievement.period) {
            repeatable[achievement.type] = repeatable[achievement.type] || []
            repeatable[achievement.type].push(achievement)
        } else {
            unique[achievement.type] = achievement
        }
    }

    return {unique, repeatable}
}

async function fetchWorldMapStructure (page, worldId, urlId) {
    debugSync(`Fetching ${worldId} map structure`)

    const structPath = await page.evaluate(function () {
        const cdn = require('cdn')
        const conf = require('conf/conf')
        return cdn.getPath(conf.getMapPath())
    })

    const buffer = await utils.getBuffer(`https://${urlId}.tribalwars2.com/${structPath}`)
    const gzipped = zlib.gzipSync(buffer)

    await fs.promises.mkdir(path.join('.', 'data', worldId), {recursive: true})
    await fs.promises.writeFile(path.join('.', 'data', worldId, 'struct'), gzipped)
}

async function fetchWorldConfig (page, worldId) {
    try {
        debugSync(`Fetching ${worldId} config`)

        const worldConfig = await page.evaluate(function () {
            const modelDataService = injector.get('modelDataService')
            const worldConfig = modelDataService.getWorldConfig().data
            const filteredConfig = {}

            const selecteConfig = [
                'speed',
                'victory_points',
                'barbarian_point_limit',
                'barbarian_spawn_rate',
                'barbarize_inactive_percent',
                'bathhouse',
                'chapel_bonus',
                'church',
                'farm_rule',
                'instant_recruit',
                'language_selection',
                'loyalty_after_conquer',
                'mass_buildings',
                'mass_recruiting',
                'noob_protection_days',
                'relocate_units',
                'resource_deposits',
                'second_village',
                'tribe_member_limit',
                'tribe_skills'
            ]

            for (const key of selecteConfig) {
                filteredConfig[key] = worldConfig[key]
            }

            return filteredConfig
        })

        await db.none(sql.updateWorldConfig, {
            worldId,
            worldConfig
        })
    } catch (error) {
        debugSync(colors.red(`Error trying to fetch ${worldId} config: ${error.message}`))
    }
}

async function fetchWorldTimeOffset (page, worldId) {
    try {
        debugSync(`Fetching ${worldId} time offset`)

        const timeOffset = await page.evaluate(function () {
            return require('helper/time').getGameTimeOffset()
        })

        await db.none(sql.updateWorldTimeOffset, {
            worldId,
            timeOffset
        })
    } catch (error) {
        debugSync(colors.red(`Error trying to fetch ${worldId} time offset: ${error.message}`))
    }
}

function initSyncSocketServer () {
    syncSocketServer = new WebSocket.Server({port: 7777})

    syncSocketServer.on('connection', function (ws) {
        const send = (state, data) => ws.send(JSON.stringify([state, data]))

        Events.on(enums.SYNC_DATA_START, (worldId) => send(enums.syncStates.START, {worldId}))
        Events.on(enums.SYNC_DATA_FINISH, (worldId, status, date) => send(enums.syncStates.FINISH, {worldId, status, date}))
        Events.on(enums.SYNC_ACHIEVEMENTS_START, (worldId) => send(enums.syncStates.ACHIEVEMENT_START, {worldId}))
        Events.on(enums.SYNC_ACHIEVEMENTS_FINISH, (worldId, status, date) => send(enums.syncStates.ACHIEVEMENT_FINISH, {worldId, status, date}))

        ws.on('message', function (raw) {
            const data = JSON.parse(raw)

            switch (data.code) {
                case enums.SYNC_REQUEST_STATUS: {
                    send(enums.syncStates.UPDATE, {
                        data: Array.from(syncDataActiveWorlds),
                        achievements: Array.from(syncAchievementsActiveWorlds)
                    })
                    break
                }
                case enums.SYNC_REQUEST_SYNC_DATA_ALL: {
                    Sync.dataAll()
                    break
                }
                case enums.SYNC_REQUEST_SYNC_DATA: {
                    Sync.data(data.marketId, data.worldNumber)
                    break
                }
                case enums.SYNC_REQUEST_SYNC_ACHIEVEMENTS_ALL: {
                    Sync.achievementsAll()
                    break
                }
                case enums.SYNC_REQUEST_SYNC_ACHIEVEMENTS: {
                    Sync.achievements(data.marketId, data.worldNumber)
                    break
                }
                case enums.SYNC_REQUEST_SYNC_MARKETS: {
                    Sync.markets()
                    break
                }
            }
        })
    })
}

async function getTasksLastRun () {
    return new Map(await db.map(sql.getTasks, [], ({id, last_run}) => [id, last_run]))
}

function getTasksInterval () {
    const entries = Object.entries(config.sync.intervals)
    const parsed = entries.map(([id, readableInterval]) => [id, humanInterval(readableInterval)])

    for (const [id] of entries) {
        db.query(sql.addTaskIfMissing, {id})
    }

    return new Map(parsed)
}

function timeSince (date) {
    const now = Date.now() + (date.getTimezoneOffset() * 1000 * 60)
    return now - date.getTime()
}

module.exports = Sync
