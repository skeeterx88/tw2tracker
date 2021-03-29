const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const humanInterval = require('human-interval');

const debug = require('./debug.js');
const {db} = require('./db.js');
const sql = require('./sql.js');
const puppeteer = require('./puppeteer.js');
const utils = require('./utils.js');
const config = require('./config.js');
const Events = require('./events.js');

const scraperData = require('./scraper-data.js');
const scraperAchievements = require('./scraper-achievements.js');
const scraperReadyState = require('./scraper-ready-state.js');

const syncCommands = require('./sync-commands.json');
const syncStatus = require('./sync-status.json');
const syncEvents = require('./sync-events.json');
const syncFlags = require('./sync-flags.json');

const ACHIEVEMENT_COMMIT_ADD = 'achievement_commit_add';
const ACHIEVEMENT_COMMIT_UPDATE = 'achievement_commit_update';

const auths = {};
const Sync = {};

const historyQueue = new GenericSyncQueue();

let browser = null;

const running = {
    data: new Set(),
    achievements: new Set()
};

const queue = {
    data: [],
    achievements: []
};
const processingQueue = {
    data: false,
    achievements: false
};
const queueEvents = {
    data: {
        START_QUEUE: 'sync_queue_data_start',
        ITEM_FINISH: syncEvents.DATA_FINISH
    },
    achievements: {
        START_QUEUE: 'sync_queue_achievements_start',
        ITEM_FINISH: syncEvents.ACHIEVEMENTS_FINISH
    }
};

Sync.init = async function () {
    debug.sync('initializing sync system');

    process.on('SIGTERM', async function () {
        await db.$pool.end();
        process.exit(0);
    });

    const appState = await db.one(sql.getProgramState);

    if (appState.first_run) {
        debug.sync('first run detected');

        await Sync.markets();
        await Sync.worlds();

        await db.query(sql.updateProgramState, {
            column: 'first_run',
            value: false
        });

        Sync.all('data');
    }

    Events.on(syncEvents.DATA_FINISH, function (worldId, status) {
        db.none(sql.updateDataSync, {status, worldId});
    });

    Events.on(syncEvents.ACHIEVEMENTS_FINISH, function (worldId, status) {
        db.none(sql.updateAchievementsSync, {status, worldId});
    });

    const tasks = await Sync.tasks();

    tasks.add('data_all', function () {
        Sync.all('data');
    });

    tasks.add('achievements_all', function () {
        Sync.all('achievements');
    });

    tasks.add('worlds', async function () {
        await Sync.markets();
        await Sync.worlds();
    });

    tasks.add('clean_shares', async function () {
        const now = Date.now();
        const shares = await db.any(sql.maps.getShareLastAccess);
        const expireTime = humanInterval(config('sync', 'static_share_expire_time'));

        for (const {share_id, last_access} of shares) {
            if (now - last_access.getTime() < expireTime) {
                await db.query(sql.maps.deleteStaticShare, [share_id]);
                // TODO: delete data as well
            }
        }
    });

    if (process.env.NODE_ENV !== 'development') {
        tasks.initChecker();
    }

    await Sync.initQueue('data');
    await Sync.initQueue('achievements');
    await initHistoryProcessing();

    // await Sync.all('data');
    // await Sync.all('achievements');

    // const worldId = 'br55';
    // const data = JSON.parse(fs.readFileSync(path.join('.', 'data', 'raw', `${worldId}.json`), 'utf8'));
    // await commitRawDataFilesystem(data, worldId);
    // await commitDataDatabase(data, worldId);
    // await commitDataFilesystem(worldId);
};

Sync.initQueue = async function (type) {
    debug.queue('initializing sync queue:%s', type);

    async function processQueue () {
        if (processingQueue[type]) {
            return false;
        }

        debug.queue('queue:%s starting', type);
        processingQueue[type] = true;

        while (queue[type].length) {
            if (running[type].size < config('sync', 'parallel_data_sync')) {
                const data = queue[type].shift();

                Sync[type](data.market_id, data.world_number, null, function () {
                    db.none(sql.removeSyncQueue, {
                        id: data.id
                    });
                });

                await db.none(sql.setQueueItemActive, {
                    id: data.id,
                    active: true
                });
            } else {
                await Events.on(queueEvents[type].ITEM_FINISH);
            }
        }

        debug.queue('queue:%s finished', type);
        processingQueue[type] = false;
    }

    Events.on(queueEvents[type].START_QUEUE, processQueue);

    await db.none(sql.resetQueueItems);
    queue[type].push(...await db.any(sql.getSyncQueueType, {type}));

    if (queue[type].length) {
        processQueue();
    }
};

Sync.addQueue = async function (type, worlds) {
    debug.queue('add queue of type %s, worlds %s', type, worlds.map(({market_id, world_number}) => market_id + world_number).join(','));

    if (!Array.isArray(worlds)) {
        throw new Error('Sync addQueue: argument "worlds" is not of type "array"');
    }

    await db.tx(async function () {
        for (const {market_id, world_number} of worlds) {
            const data = await this.one(sql.addSyncQueue, {type, market_id, world_number});
            queue[type].push(data);
        }
    });

    if (!processingQueue[type]) {
        Events.trigger(queueEvents[type].START_QUEUE);
    }
};

Sync.trigger = function (msg) {
    switch (msg.command) {
        case syncCommands.DATA_ALL: {
            Sync.all('data');
            break;
        }
        case syncCommands.DATA: {
            Sync.addQueue('data', [{
                market_id: msg.marketId,
                world_number: msg.worldNumber
            }]);
            break;
        }
        case syncCommands.ACHIEVEMENTS_ALL: {
            Sync.all('achievements');
            break;
        }
        case syncCommands.ACHIEVEMENTS: {
            Sync.addQueue('achievements', [{
                market_id: msg.marketId,
                world_number: msg.worldNumber
            }]);
            break;
        }
        case syncCommands.MARKETS: {
            Sync.markets();
            break;
        }
        case syncCommands.WORLDS: {
            Sync.worlds();
            break;
        }
        case syncCommands.TOGGLE: {
            Sync.toggle(msg.marketId, msg.worldNumber);
            break;
        }
    }
};

Sync.data = async function (marketId, worldNumber, flag, callback, attempt = 1) {
    const worldId = marketId + worldNumber;

    if (running.data.has(worldId)) {
        debug.sync('world:%s sync in progress', worldId);
        return false;
    }

    running.data.add(worldId);

    const market = await db.one(sql.getMarket, {marketId});
    const world = await getWorld(worldId);
    const marketAccounts = await db.any(sql.getMarketAccounts, {marketId});

    if (!marketAccounts.length) {
        debug.sync('market:%s does not have any sync accounts', marketId);
        Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.NO_ACCOUNTS]);
        running.data.delete(worldId);
        return false;
    }

    Events.trigger(syncEvents.DATA_START, [worldId]);
    debug.sync('world:%s start data sync (attempt %i)', worldId, attempt);

    let page;

    try {
        await utils.timeout(async function () {
            const urlId = marketId === 'zz' ? 'beta' : marketId;

            if (!world.sync_enabled) {
                Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.FAIL]);
                running.data.delete(worldId);
                return false;
            }

            if (flag !== syncFlags.IGNORE_LAST_SYNC && world.last_data_sync_date) {
                const elapsedTime = utils.UTC() - world.last_data_sync_date;

                if (elapsedTime < humanInterval(config('sync', 'min_time_between_data_syncs'))) {
                    debug.sync('world:%s already sinced', worldId);
                    Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.ALREADY_SYNCED]);
                    running.data.delete(worldId);
                    return false;
                }
            }

            const account = await Sync.auth(marketId);

            if (!account) {
                debug.sync('world:%s all accounts failed to authenticate', worldId);
                Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.NO_ACCOUNTS]);
                running.data.delete(worldId);
                return false;
            }

            const worldCharacter = account.characters.find(({world_id}) => world_id === worldId);

            if (!worldCharacter) {
                await Sync.character(marketId, worldNumber);
            } else if (!worldCharacter.allow_login) {
                await db.query(sql.closeWorld, [marketId, worldNumber]);
                debug.sync('world:%s closing', worldId);
                Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.WORLD_CLOSED]);
                running.data.delete(worldId);
                return false;
            }

            page = await createPuppeteerPage();
            await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']});

            debug.sync('world:%s waiting ready state', worldId);

            await page.evaluate(scraperReadyState, {
                timeout: humanInterval(config('sync_timeouts', 'ready_state'))
            });

            if (!fs.existsSync(path.join('.', 'data', worldId, 'struct'))) {
                await fetchWorldMapStructure(page, worldId, urlId);
            }

            if (!world.config) {
                await fetchWorldConfig(page, worldId);
            }

            if (market.time_offset === null) {
                await fetchMarketTimeOffset(page, worldId);
            }

            debug.sync('world:%s fetching data', worldId);

            const data = await page.evaluate(scraperData, {
                loadContinentTimeout: humanInterval(config('sync_timeouts', 'load_continent')),
                loadContinentSectionTimeout: humanInterval(config('sync_timeouts', 'load_continent_section'))
            });
            await commitRawDataFilesystem(data, worldId);
            await commitDataDatabase(data, worldId);
            await commitDataFilesystem(worldId);

            await page.close();

            debug.sync('world:%s data sync finished', worldId);
            Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.SUCCESS]);
            running.data.delete(worldId);
        }, humanInterval(config('sync', 'max_sync_data_running_time')));

        if (callback) {
            callback(true);
        }

        return true;
    } catch (error) {
        debug.sync('world:%s data sync failed (%s)', worldId, error.message);
        running.data.delete(worldId);

        if (page) {
            await page.close();
        }

        if (attempt < config('sync', 'max_sync_attempts')) {
            return await Sync.data(marketId, worldNumber, flag, callback, attempt + 1);
        } else {
            if (callback) {
                callback(false);
            }

            Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.FAIL]);
            throw new Error(error.message);
        }
    }
};

Sync.achievements = async function (marketId, worldNumber, flag, callback, attempt = 1) {
    const worldId = marketId + worldNumber;

    if (running.achievements.has(worldId)) {
        debug.sync('world:%s is already syncing achievements', worldId);
        return false;
    }

    running.achievements.add(worldId);

    const world = await getWorld(worldId);
    const marketAccounts = await db.any(sql.getMarketAccounts, {marketId});

    if (!marketAccounts.length) {
        debug.sync('market:%s does not have any sync accounts', marketId);
        Events.trigger(syncEvents.ACHIEVEMENTS_FINISH, [worldId, syncStatus.NO_ACCOUNTS]);
        running.achievements.delete(worldId);
        return false;
    }

    debug.sync('world:%s start achievements sync (attempt %d)', worldId, attempt);
    Events.trigger(syncEvents.ACHIEVEMENTS_START, [worldId]);

    let page;

    try {
        await utils.timeout(async function () {
            const urlId = marketId === 'zz' ? 'beta' : marketId;

            if (!world.sync_enabled) {
                Events.trigger(syncEvents.ACHIEVEMENTS_FINISH, [worldId, syncStatus.FAIL]);
                running.achievements.delete(worldId);
                return false;
            }

            if (flag !== syncFlags.IGNORE_LAST_SYNC && world.last_achievements_sync_date) {
                const elapsedTime = utils.UTC() - world.last_achievements_sync_date;

                if (elapsedTime < humanInterval(config('sync', 'min_time_between_achievement_syncs'))) {
                    debug.sync('world:%s already sinced', worldId, attempt);
                    Events.trigger(syncEvents.DATA_FINISH, [worldId, syncStatus.ALREADY_SYNCED]);
                    running.data.delete(worldId);
                    return false;
                }
            }

            const account = await Sync.auth(marketId);

            if (!account) {
                debug.sync('world:%s all accounts failed to authenticate', worldId);
                Events.trigger(syncEvents.ACHIEVEMENTS_FINISH, [worldId, syncStatus.AUTH_FAILED]);
                running.achievements.delete(worldId);
                return false;
            }

            page = await createPuppeteerPage();
            await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${marketId}${worldNumber}&character_id=${account.player_id}`, {waitFor: ['domcontentloaded', 'networkidle2']});
            await page.evaluate(scraperReadyState, {
                timeout: humanInterval(config('sync_timeouts', 'ready_state'))
            });

            const achievements = await page.evaluate(scraperAchievements, marketId, worldNumber);
            await commitRawAchievementsFilesystem(achievements, worldId);
            await commitAchievementsDatabase(achievements, worldId);

            await page.close();

            debug.sync('world:%s achievements sync finished', worldId);
            Events.trigger(syncEvents.ACHIEVEMENTS_FINISH, [worldId, syncStatus.SUCCESS]);
            running.achievements.delete(worldId);
        }, humanInterval(config('sync', 'max_sync_achievements_running_time')));

        if (callback) {
            callback(true);
        }

        return true;
    } catch (error) {
        debug.sync('world:%s achievements sync failed (%s)', worldId, error.message);
        running.achievements.delete(worldId);

        if (page) {
            await page.close();
        }

        if (attempt < config('sync', 'max_sync_attempts')) {
            return await Sync.achievements(marketId, worldNumber, flag, callback, attempt + 1);
        } else {
            if (callback) {
                callback(false);
            }

            Events.trigger(syncEvents.ACHIEVEMENTS_FINISH, [worldId, syncStatus.FAIL]);
            throw new Error(error.message);
        }
    }
};

Sync.all = async function (type, flag) {
    const syncQueue = await db.map(sql.getSyncQueueNonActive, [], ({market_id, world_number}) => market_id + world_number);
    const worlds = await db.map(sql.getSyncEnabledWorlds, [], function (world) {
        return !syncQueue.includes(world.world_id) ? {market_id: world.market, world_number: world.num} : false;
    });
    const uniqueWorlds = worlds.filter(world => world !== false);

    Sync.addQueue(type, uniqueWorlds);
};

Sync.worlds = async function () {
    debug.worlds('start world list sync');

    const markets = await db.any(sql.getMarkets);

    for (const market of markets) {
        const marketId = market.id;

        debug.worlds('market:%s check missing worlds', marketId);

        try {
            const account = await Sync.auth(marketId);

            if (!account) {
                continue;
            }

            const characters = account.characters
                .filter((world) => world.allow_login && world.character_id === account.player_id)
                .map(world => ({
                    worldNumber: utils.extractNumbers(world.world_id),
                    worldName: world.world_name,
                    registered: true
                }));

            const worlds = account.worlds
                .filter(world => !world.full)
                .map(world => ({
                    worldNumber: utils.extractNumbers(world.id),
                    worldName: world.name,
                    registered: false
                }));

            const allWorlds = [...worlds, ...characters];

            for (const world of allWorlds) {
                const {worldNumber, worldName, registered} = world;
                const worldId = marketId + worldNumber;

                if (!registered) {
                    await Sync.character(marketId, worldNumber);
                }

                if (!await utils.worldEntryExists(worldId)) {
                    debug.worlds('world:%s creating world db entry', worldId);

                    await db.query(sql.createWorldSchema, {
                        worldId,
                        marketId,
                        worldNumber,
                        worldName,
                        open: true
                    });
                }
            }
        } catch (error) {
            debug.worlds('market:%s failed to sync worlds (%s)', marketId, error.message);
        }
    }
};

Sync.markets = async function () {
    debug.sync('start market list sync');

    const storedMarkets = await db.map(sql.getMarkets, [], market => market.id);
    const $portalBar = await utils.getHTML('https://tribalwars2.com/portal-bar/https/portal-bar.html');
    const $markets = $portalBar.querySelectorAll('.pb-lang-sec-options a');

    const marketList = $markets.map(function ($market) {
        const market = $market.attributes.href.split('//')[1].split('.')[0];
        return market === 'beta' ? 'zz' : market;
    });

    const missingMarkets = marketList.filter(marketId => !storedMarkets.includes(marketId));

    for (const marketId of missingMarkets) {
        await db.query(sql.addMarket, {marketId});
    }

    return missingMarkets;
};

Sync.character = async function (marketId, worldNumber) {
    const worldId = marketId + worldNumber;

    debug.sync('world:%s create character', worldId);

    const page = await createPuppeteerPage();
    await page.goto(`https://${marketId}.tribalwars2.com/page`, {
        waitUntil: ['domcontentloaded', 'networkidle0']
    });

    const response = await page.evaluate(function (worldId) {
        return new Promise(function (resolve) {
            const socketService = injector.get('socketService');
            const routeProvider = injector.get('routeProvider');

            debug('world:%s emit create character command', worldId);

            socketService.emit(routeProvider.CREATE_CHARACTER, {
                world: worldId
            }, resolve);
        });
    }, worldId);

    page.close();

    if (response.id && response.world_id) {
        debug.sync('world:%s character created %o', worldId. response);
    } else {
        debug.sync('world:%s failed to create character %o', worldId, response);
    }
};

Sync.auth = async function (marketId, attempt = 1) {
    if (auths[marketId]) {
        return await auths[marketId];
    }

    let page;

    try {
        auths[marketId] = utils.timeout(async function () {
            const accounts = await db.any(sql.getMarketAccounts, {marketId});

            if (!accounts.length) {
                debug.auth('market:%s do not have any accounts', marketId, attempt);
                return false;
            }

            const credentials = accounts[attempt - 1];

            if (!credentials) {
                debug.auth('market:%s all accounts failed to authenticate', marketId, attempt);
                return false;
            }

            debug.auth('market:%s authenticating (attempt %d)', marketId, attempt);

            const urlId = marketId === 'zz' ? 'beta' : marketId;

            debug.auth('market:%s loading page', marketId);

            page = await createPuppeteerPage();
            await page.goto(`https://${urlId}.tribalwars2.com/page`, {
                waitUntil: ['domcontentloaded', 'networkidle0']
            });

            const account = await page.evaluate(function (marketId, credentials, config) {
                return new Promise(function (resolve, reject) {
                    const socketService = injector.get('socketService');
                    const routeProvider = injector.get('routeProvider');

                    const loginTimeout = setTimeout(function () {
                        reject('emit credentials timeout');
                    }, config.authSocketEmitTimeout);

                    debug('market:%s emit login command', marketId);

                    socketService.emit(routeProvider.LOGIN, {...credentials, ref_param: ''}, function (data) {
                        clearTimeout(loginTimeout);
                        resolve(data);
                    });
                });
            }, marketId, credentials, {
                authSocketEmitTimeout: humanInterval(config('sync_timeouts', 'auth_socket_emit'))
            });

            if (!account) {
                const error = await page.$eval('.login-error .error-message', $elem => $elem.textContent);
                throw new Error(error);
            }

            debug.auth('market:%s setup cookie', marketId);

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
            });

            debug.auth('market:%s checking auth success', marketId);

            await page.goto(`https://${urlId}.tribalwars2.com/page`, {
                waitUntil: ['domcontentloaded', 'networkidle0']
            });

            try {
                await page.waitForSelector('.player-worlds', {timeout: 3000});
            } catch (error) {
                throw new Error('Unknown reason');
            }

            await page.close();
            debug.auth('market:%s authentication success', marketId);

            return account;
        }, '1 minute');

        if (auths[marketId] === false) {
            delete auths[marketId];
            return false;
        }

        return await auths[marketId];
    } catch (error) {
        delete auths[marketId];

        if (page) {
            await page.close();
        }

        if (attempt < config('sync', 'max_login_attempts')) {
            debug.auth('market:%s authentication failed (%s)', marketId, error.message);
            return await Sync.auth(marketId, attempt + 1);
        } else {
            debug.auth('market:%s authentication failed (maximum attempts reached)');
            throw new Error(error.message);
        }
    }
};

Sync.tasks = async function () {
    debug.tasks('initializing task system');

    const taskHandlers = new Map();
    const intervalKeys = Object.keys(config('sync_intervals'));
    const presentTasks = await db.any(sql.getTasks);
    const interval = humanInterval(config('sync', 'task_check_interval'));

    for (const {id} of presentTasks) {
        if (!intervalKeys.includes(id)) {
            debug.tasks('task:%s add missing db entry', id);
            db.query(sql.addTaskIfMissing, {id});
        }
    }

    return {
        add: function (id, handler) {
            taskHandlers.set(id, handler);
        },
        initChecker: function () {
            debug.tasks('start task checker (interval: %s)', config('sync', 'task_check_interval'));

            const intervalEntries = Object.entries(config('sync_intervals'));
            const parsedIntervals = intervalEntries.map(([id, readableInterval]) => [id, humanInterval(readableInterval)]);
            const mappedIntervals = new Map(parsedIntervals);

            setInterval(async function () {
                debug.tasks('checking tasks...');

                const lastRunEntries = await db.map(sql.getTasks, [], ({id, last_run}) => [id, last_run]);
                const mappedLastRuns = new Map(lastRunEntries);

                for (const [id, handler] of taskHandlers.entries()) {
                    const interval = mappedIntervals.get(id);
                    const lastRun = mappedLastRuns.get(id);

                    if (lastRun) {
                        const elapsedTime = (Date.now() + (lastRun.getTimezoneOffset() * 1000 * 60)) - lastRun.getTime();

                        if (elapsedTime < interval) {
                            continue;
                        }
                    }

                    debug.tasks('task:%s running', id);
                    handler();
                    db.query(sql.updateTaskLastRun, {id});
                }
            }, interval);
        }
    };
};

Sync.toggle = async function (marketId, worldNumber) {
    const worldId = marketId + worldNumber;
    const world = await getWorld(worldId);
    const enabled = !world.sync_enabled;

    await db.query(sql.syncToggleWorld, {
        marketId,
        worldNumber,
        enabled
    });

    Events.trigger(syncEvents.TOGGLE_WORLD, [marketId, worldNumber, enabled]);

    return true;
};

Sync.createAccounts = async function (name, pass, mail) {
    const markets = await db.any(sql.getMarkets);

    for (const market of markets) {
        const urlId = market.id === 'zz' ? 'beta' : market.id;
        const page = await createPuppeteerPage();
        await page.goto(`https://${urlId}.tribalwars2.com/page`, {
            waitUntil: ['domcontentloaded', 'networkidle2']
        });

        const created = await page.evaluate(function (name, mail, pass, marketId) {
            return new Promise(function (resolve, reject) {
                setTimeout(function () {
                    const socketService = injector.get('socketService');
                    const routeProvider = injector.get('routeProvider');

                    debug('market:%s emit create account command', marketId);

                    const timeout = setTimeout(function () {
                        resolve(false);
                    }, 20000);

                    socketService.emit(routeProvider.REGISTER, {
                        name,
                        mail,
                        pass,
                        pass_wh: pass,
                        agb: true,
                        invite_key: '',
                        newsletter: false,
                        platform: 'browser',  
                        portal_data: `portal_tid=${Date.now()}-${Math.round(Math.random() * 100000)}`,
                        start_page_type: 'game_v1'
                    }, function () {
                        clearTimeout(timeout);
                        resolve(true);
                    });
                }, 1000);
            });
        }, name, mail, pass, market.id);

        await page.close();

        if (created) {
            debug.sync('market:%s account "%s" created', market.id, name);

            const [exists] = await db.any(sql.getAccountByName, {name});
            const {id} = exists ? exists : await db.one(sql.addAccount, {name, pass});
            await db.query(sql.addAccountMarket, {accountId: id, marketId: market.id});
        } else {
            debug.sync('market:%s fail creating account "%s"', market.id, name);
        }
    }
};

async function commitDataDatabase (data, worldId) {
    debug.db('world:%s commit db data', worldId);

    const [
        entriesPlayersOld,
        entriesTribesOld,
        entriesVillagesOld,
        entriesPlayerRecordsOld, 
        entriesTribeRecordsOld
    ] = await db.task(async db => [
        await db.map(sql.getActiveSubjects, {worldId, type: 'players'}, subject => [subject.id, subject]),
        await db.map(sql.getActiveSubjects, {worldId, type: 'tribes'}, subject => [subject.id, subject]),
        await db.map(sql.getWorldVillages, {worldId}, subject => [subject.id, subject]),
        await db.map(sql.getSubjectRecords, {worldId, type: 'players'}, subject => [subject.id, [subject.best_rank, subject.best_points, subject.best_villages]]),
        await db.map(sql.getSubjectRecords, {worldId, type: 'tribes'}, subject => [subject.id, [subject.best_rank, subject.best_points, subject.best_villages]])
    ]);

    const playersOld = new Map(entriesPlayersOld);
    const playersNew = new Map(data.players);
    const tribesOld = new Map(entriesTribesOld);
    const tribesNew = new Map(data.tribes);
    const villagesOld = new Map(entriesVillagesOld);
    const villagesNew = new Map(data.villages);
    const playerRecordsOld = new Map(entriesPlayerRecordsOld);
    const tribeRecordsOld = new Map(entriesTribeRecordsOld);

    const playersOldIds = Array.from(playersOld.keys());
    const playersNewIds = Array.from(playersNew.keys());
    const tribesOldIds = Array.from(tribesOld.keys());
    const tribesNewIds = Array.from(tribesNew.keys());
    const villagesNewIds = Array.from(villagesNew.keys());
    const villagesOldIds = Array.from(villagesOld.keys());

    const missingPlayersIds = playersOldIds.filter(tribeId => !playersNewIds.includes(tribeId));
    const missingTribesIds = tribesOldIds.filter(tribeId => !tribesNewIds.includes(tribeId));
    const missingVillagesIds = villagesNewIds.filter(villageId => !villagesOldIds.includes(villageId));

    const newPlayersIds = playersNewIds.filter(tribeId => !playersOldIds.includes(tribeId));
    const newTribesIds = tribesNewIds.filter(tribeId => !tribesOldIds.includes(tribeId));
    const newVillagesIds = villagesOldIds.filter(villageId => !villagesNewIds.includes(villageId));

    await db.tx(async function (db) {
        let conquestsCount = 0;
        let tribeChangesCount = 0;

        async function updateSubjectsData () {
            for (const [id, subject] of data.tribes) {
                if (tribesOld.has(id)) {
                    await db.query(sql.updateTribe, {worldId, id, ...subject});
                } else {
                    await db.query(sql.addTribe, {worldId, id, ...subject});
                }
            }

            for (const [id, subject] of data.players) {
                if (playersOld.has(id)) {
                    await db.query(sql.updatePlayer, {worldId, id, ...subject});
                } else {
                    await db.query(sql.addPlayer, {worldId, id, ...subject});
                }
            }
        }

        async function updateConquests () {
            for (const [village_id, village] of villagesNew.entries()) {
                const oldVillage = villagesOld.has(village_id)
                    ? villagesOld.get(village_id)
                    : {village_id, ...village};

                if (village.character_id !== oldVillage.character_id && village.character_id) {
                    const newOwnerId = village.character_id;
                    const newOwner = playersNew.get(newOwnerId);
                    const oldOwner = missingVillagesIds.includes(village_id) ? null : playersNew.get(oldVillage.character_id);
                    const oldOwnerId = oldOwner ? oldVillage.character_id : null;

                    const tribeData = {
                        new_owner_tribe_id: null,
                        new_owner_tribe_tag_then: null,
                        old_owner_tribe_id: null,
                        old_owner_tribe_tag_then: null
                    };

                    if (newOwner.tribe_id) {
                        tribeData.new_owner_tribe_id = newOwner.tribe_id;
                        tribeData.new_owner_tribe_tag_then = tribesNew.get(newOwner.tribe_id).tag;
                    }

                    if (oldOwner && oldOwner.tribe_id) {
                        tribeData.old_owner_tribe_id = oldOwner.tribe_id;
                        tribeData.old_owner_tribe_tag_then = tribesNew.get(oldOwner.tribe_id).tag;
                    }

                    await db.query(sql.addConquest, {
                        worldId,
                        village_id,
                        newOwner: newOwnerId,
                        oldOwner: oldOwnerId,
                        village_points_then: village.points,
                        ...tribeData
                    });

                    conquestsCount++;
                }
            }
        }

        async function updateMissingSubjects () {
            for (const id of missingPlayersIds) {
                await db.query(sql.archivePlayer, {worldId, id});
            }

            for (const id of missingTribesIds) {
                await db.query(sql.archiveTribe, {worldId, id});
            }
        }

        async function updateSubjectsRecords () {
            const oldRecords = {
                players: playerRecordsOld,
                tribes: tribeRecordsOld
            };

            for (const type of ['tribes', 'players']) {
                for (const [id, subject] of data[type]) {
                    const [bestRank, bestPoints, bestVillages] = oldRecords[type].get(id) || [];

                    if (!bestRank || subject.rank <= bestRank) {
                        await db.query(sql.updateSubjectRecord, {worldId, type, recordType: 'rank', id, value: subject.rank});
                    }

                    if (!bestPoints || subject.points >= bestPoints) {
                        await db.query(sql.updateSubjectRecord, {worldId, type, recordType: 'points', id, value: subject.points});
                    }

                    if (!bestVillages || subject.villages >= bestVillages) {
                        await db.query(sql.updateSubjectRecord, {worldId, type, recordType: 'villages', id, value: subject.villages});
                    }
                }
            }
        }

        async function updateProvinces () {
            for (const [province_name, province_id] of data.provinces) {
                await db.query(sql.addProvince, {worldId, province_id, province_name});
            }
        }

        async function updateVillages () {
            for (const [village_id, village] of data.villages) {
                await db.query(sql.addVillage, {worldId, village_id, ...village});
            }
        }

        async function updateTribeMemberChanges () {
            for (const [character_id, playerNewData] of playersNew.entries()) {
                const playerOldData = playersOld.get(character_id);

                const oldTribeId = playerOldData ? playerOldData.tribe_id : null;
                const newTribeId = playerNewData.tribe_id;

                if (oldTribeId !== newTribeId) {
                    const oldTribe = tribesOld.get(oldTribeId);
                    const newTribe = tribesOld.get(newTribeId);

                    await db.query(sql.addTribeMemberChange, {
                        worldId,
                        character_id,
                        old_tribe: oldTribeId,
                        new_tribe: newTribeId,
                        old_tribe_tag_then: oldTribe ? oldTribe.tag : null,
                        new_tribe_tag_then: newTribe ? newTribe.tag : null
                    });

                    tribeChangesCount++;
                }
            }
        }

        async function updatePlayerVillages () {
            for (const [character_id, villages_id] of data.villagesByPlayer) {
                await db.query(sql.updatePlayerVillages, {worldId, character_id, villages_id});
            }
        }

        async function updateSubjectAvgCoords () {
            const players = {};
            const tribes = {};

            for (const [playerId, villageIds] of data.villagesByPlayer) {
                if (!villageIds.length) {
                    continue;
                }

                let sumX = 0;
                let sumY = 0;

                for (const vid of villageIds) {
                    const {x, y} = villagesNew.get(vid);
                    sumX += x;
                    sumY += y;
                }

                const avgX = Math.floor(sumX / villageIds.length);
                const avgY = Math.floor(sumY / villageIds.length);
                const avg = [avgX, avgY];

                players[playerId] = avg;
            }

            for (const [tribeId, tribeMembers] of data.playersByTribe) {
                if (!tribeMembers.length) {
                    continue;
                }

                let count = 0;
                let sumX = 0;
                let sumY = 0;

                for (const pid of tribeMembers) {
                    if (players[pid]) {
                        const [x, y] = players[pid];
                        sumX += x;
                        sumY += y;
                        count++;
                    }
                }

                if (!count) {
                    continue;
                }

                const avgX = Math.floor(sumX / count);
                const avgY = Math.floor(sumY / count);
                const avg = [avgX, avgY];

                tribes[tribeId] = avg;
            }

            for (const [id, avg] of Object.entries(players)) {
                await db.query(sql.updateSubjectAvgCoords, {worldId, type: 'players', id, avg});
            }

            for (const [id, avg] of Object.entries(tribes)) {
                await db.query(sql.updateSubjectAvgCoords, {worldId, type: 'tribes', id, avg});
            }
        }

        async function updateWorldStats () {
            await db.query(sql.updateWorldStats, {
                worldId,
                villages: data.villages.length,
                players: data.players.length,
                tribes: data.tribes.length
            });
        }

        await updateSubjectsData();
        await updateMissingSubjects();
        await updateSubjectsRecords();
        await updateProvinces();
        await updateVillages();
        await updatePlayerVillages();
        await updateConquests();
        await updateTribeMemberChanges();
        await updateSubjectAvgCoords();
        await updateWorldStats();

        debug.db('world:%s commit db data result %o', worldId, {
            'new players': newPlayersIds.length,
            'new tribes': newTribesIds.length,
            'new villages': newVillagesIds.length,
            'archived players': missingPlayersIds.length,
            'archived tribes': missingTribesIds.length,
            'new conquests': conquestsCount,
            'new tribe changes': tribeChangesCount
        });
    });
}

async function commitAchievementsDatabase (data, worldId) {
    debug.db('world:%s commit db achievements', worldId);

    const sqlSubjectMap = {
        players: {
            [ACHIEVEMENT_COMMIT_ADD]: sql.addPlayerAchievement,
            [ACHIEVEMENT_COMMIT_UPDATE]: sql.updatePlayerAchievement
        },
        tribes: {
            [ACHIEVEMENT_COMMIT_ADD]: sql.addTribeAchievement,
            [ACHIEVEMENT_COMMIT_UPDATE]: sql.updateTribeAchievement
        }
    };

    await db.tx(async function (tx) {
        const log = {};

        for (const subjectType of ['players', 'tribes']) {
            const modifiedAchievements = await getModifiedAchievements(tx, subjectType, data[subjectType], worldId);

            for (const {commitType, achievement} of modifiedAchievements) {
                tx.none(sqlSubjectMap[subjectType][commitType], {
                    worldId,
                    id: achievement.id,
                    type: achievement.type,
                    category: achievement.category,
                    level: achievement.level,
                    period: achievement.period || null,
                    time_last_level: achievement.time_last_level ? new Date(achievement.time_last_level * 1000) : null
                });
            }

            log[subjectType] = {
                added: modifiedAchievements.filter(({commitType}) => commitType === ACHIEVEMENT_COMMIT_ADD).length,
                updated: modifiedAchievements.filter(({commitType}) => commitType === ACHIEVEMENT_COMMIT_UPDATE).length
            };
        }

        debug.db('world:%s commit db achievements result %o', worldId, log);
    });
}

async function commitDataFilesystem (worldId) {
    debug.sync('world:%s commit fs data', worldId);

    try {
        const [
            world,
            players,
            villages,
            tribes,
            provinces
        ] = await db.task(async (db) => [
            await db.one(sql.getWorld, {worldId}),
            await db.any(sql.getWorldData, {worldId, table: 'players', sort: 'rank'}),
            await db.any(sql.getWorldData, {worldId, table: 'villages', sort: 'points'}),
            await db.any(sql.getWorldData, {worldId, table: 'tribes', sort: 'rank'}),
            await db.any(sql.getWorldData, {worldId, table: 'provinces', sort: 'id'})
        ]);

        const parsedPlayers = [];
        const parsedTribes = [];
        const continents = {};
        const parsedProvinces = [];

        const dataPath = path.join('.', 'data', worldId);

        await fs.promises.mkdir(dataPath, {recursive: true});
        for (const player of players) {
            if (!player.archived) {
                parsedPlayers.push([player.id, [
                    player.name,
                    player.tribe_id || 0,
                    player.points,
                    player.villages,
                    player.avg_coords,
                    player.bash_points_off,
                    player.bash_points_def,
                    player.victory_points || 0,
                    player.rank
                ]]);
            }
        }

        for (const village of villages) {
            const {id, x, y, name, points, character_id, province_id} = village;

            let kx;
            let ky;

            if (x < 100) {
                kx = '0';
            } else {
                kx = String(x)[0];
            }

            if (y < 100) {
                ky = '0';
            } else {
                ky = String(y)[0];
            }

            const k = parseInt(ky + kx, 10);

            if (!utils.hasOwn(continents, k)) {
                continents[k] = {};
            }

            if (!utils.hasOwn(continents[k], x)) {
                continents[k][x] = {};
            }

            continents[k][x][y] = [id, name, points, character_id || 0, province_id];
        }

        for (const k in continents) {
            const data = JSON.stringify(continents[k]);
            await fs.promises.writeFile(path.join(dataPath, k), zlib.gzipSync(data));
        }

        for (const tribe of tribes) {
            if (!tribe.archived) {
                parsedTribes.push([tribe.id, [
                    tribe.name,
                    tribe.tag,
                    tribe.points,
                    tribe.villages,
                    tribe.avg_coords,
                    tribe.bash_points_off,
                    tribe.bash_points_def,
                    tribe.victory_points || 0,
                    tribe.rank
                ]]);
            }
        }

        for (const {name} of provinces) {
            parsedProvinces.push(name);
        }

        const info = {
            config: world.config,
            players: parsedPlayers,
            tribes: parsedTribes,
            provinces: parsedProvinces
        };

        const gzippedInfo = zlib.gzipSync(JSON.stringify(info));
        await fs.promises.writeFile(path.join(dataPath, 'info'), gzippedInfo);
    } catch (error) {
        debug.sync('world:%s failed to commit fs data (%s)', worldId, error.message);
    }

    return false;
}

async function commitRawDataFilesystem (data, worldId) {
    debug.sync('world:%s commit fs raw data', worldId);

    const location = path.join('.', 'data', 'raw');
    await fs.promises.mkdir(location, {recursive: true});
    await fs.promises.writeFile(path.join(location, `${worldId}.json`), JSON.stringify(data));
}

async function commitRawAchievementsFilesystem (achievements, worldId) {
    debug.sync('world:%s commit fs raw achievements', worldId);

    const location = path.join('.', 'data', 'raw');
    await fs.promises.mkdir(location, {recursive: true});
    await fs.promises.writeFile(path.join(location, `${worldId}-achievements.json`), JSON.stringify(achievements));
}

async function createPuppeteerPage () {
    if (!browser) {
        browser = new Promise(function (resolve) {
            puppeteer().then(resolve);
        });
    }

    if (browser instanceof Promise) {
        browser = await browser;
    }

    const page = await browser.newPage();
    await page.exposeFunction('debug', debug.puppeteer);
    await page.exposeFunction('humanInterval', humanInterval);
    return page;
}

async function getWorld (worldId) {
    let world;

    try {
        world = await db.one(sql.getWorld, {worldId});
    } catch (e) {
        throw new Error(`World ${worldId} not found.`);
    }

    if (!world.open) {
        throw new Error(`World ${worldId} is closed`);
    }

    return world;
}

async function getModifiedAchievements (tx, subjectType, achievements, worldId) {
    const achievementsToCommit = [];

    const sqlAchievementsMap = {
        players: sql.getPlayerAchievements,
        tribes: sql.getTribeAchievements
    };

    for (const [subjectId, newAchievementsRaw] of achievements) {
        const achievementsToMerge = [];

        const oldAchievementsRaw = await tx.any(sqlAchievementsMap[subjectType], {worldId, id: subjectId});

        if (oldAchievementsRaw.length) {
            const oldAchievements = mapAchievements(oldAchievementsRaw);
            const newAchievements = mapAchievements(newAchievementsRaw);

            const oldUniqueTypes = Object.keys(oldAchievements.unique);
            const newUniqueTypes = Object.keys(newAchievements.unique);

            if (newAchievementsRaw.length > oldAchievementsRaw.length) {
                const missingTypes = newUniqueTypes.filter(type => !oldUniqueTypes.includes(type));

                for (const type of missingTypes) {
                    achievementsToMerge.push({
                        commitType: ACHIEVEMENT_COMMIT_ADD,
                        achievement: newAchievements.unique[type]
                    });
                }
            }

            for (const type of oldUniqueTypes) {
                if (!newAchievements.unique[type]) {
                    debug.sync('*New* achievement do not have *old* achievement: %s', type);
                    continue;
                }

                if (newAchievements.unique[type].level > oldAchievements.unique[type].level) {
                    achievementsToMerge.push({
                        commitType: ACHIEVEMENT_COMMIT_UPDATE,
                        achievement: newAchievements.unique[type]
                    });
                }
            }

            for (const type of Object.keys(newAchievements.repeatable)) {
                const newRepeatable = newAchievements.repeatable[type];
                const oldRepeatable = oldAchievements.repeatable[type];

                const merge = [];

                if (!oldRepeatable) {
                    merge.push(...newRepeatable);
                } else if (oldRepeatable.length !== newRepeatable.length) {
                    merge.push(...newRepeatable.slice(oldRepeatable.length, newRepeatable.length));
                }

                achievementsToMerge.push(...merge.map(achievement => {
                    return {
                        commitType: ACHIEVEMENT_COMMIT_ADD,
                        achievement
                    };
                }));
            }
        } else {
            achievementsToMerge.push(...newAchievementsRaw.map(achievement => {
                return {
                    commitType: ACHIEVEMENT_COMMIT_ADD,
                    achievement
                };
            }));
        }

        const achievementsToMergeMap = achievementsToMerge.map(function (commit) {
            commit.achievement.id = subjectId;
            return commit;
        });

        achievementsToCommit.push(...achievementsToMergeMap);
    }

    return achievementsToCommit;
}

function mapAchievements (achievements) {
    const unique = {};
    const repeatable = {};

    for (const achievement of achievements) {
        if (achievement.period) {
            repeatable[achievement.type] = repeatable[achievement.type] || [];
            repeatable[achievement.type].push(achievement);
        } else {
            unique[achievement.type] = achievement;
        }
    }

    return {unique, repeatable};
}

async function fetchWorldMapStructure (page, worldId, urlId) {
    debug.sync('world:%s fetch map structure', worldId);

    const structPath = await page.evaluate(function () {
        const cdn = require('cdn');
        const conf = require('conf/conf');
        return cdn.getPath(conf.getMapPath());
    });

    const buffer = await utils.getBuffer(`https://${urlId}.tribalwars2.com/${structPath}`);
    const gzipped = zlib.gzipSync(buffer);

    await fs.promises.mkdir(path.join('.', 'data', worldId), {recursive: true});
    await fs.promises.writeFile(path.join('.', 'data', worldId, 'struct'), gzipped);
}

async function fetchWorldConfig (page, worldId) {
    try {
        debug.sync('world:%s fetch config', worldId);

        const worldConfig = await page.evaluate(function () {
            const modelDataService = injector.get('modelDataService');
            const worldConfig = modelDataService.getWorldConfig().data;
            const filteredConfig = {};

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
            ];

            for (const key of selecteConfig) {
                filteredConfig[key] = worldConfig[key];
            }

            return filteredConfig;
        });

        await db.none(sql.updateWorldConfig, {
            worldId,
            worldConfig
        });
    } catch (error) {
        debug.sync('world:%s error fetching config (%s)', worldId, error.message);
    }
}

async function fetchMarketTimeOffset (page, marketId) {
    try {
        debug.sync('world:%s fetch timezone', marketId);

        const timeOffset = await page.evaluate(function () {
            return require('helper/time').getGameTimeOffset();
        });

        await db.none(sql.updateMarketTimeOffset, {
            marketId,
            timeOffset
        });
    } catch (error) {
        debug.sync('world:%s error fetching timezone (%s)', worldId, error.message);
    }
}

async function initHistoryProcessing (marketId) {
    const markets = marketId
        ? await db.any(sql.getMarket, {marketId})
        : await db.any(sql.getMarkets);

    for (const market of markets) {
        const untilMidnight = getTimeUntilMidnight(market.time_offset);

        debug.history('market:%s history process starts in %i hours', market.id, Math.floor(untilMidnight / 1000 / 60 / 60));

        setTimeout(async function () {
            historyQueue.add(async function () {
                const marketWorlds = await db.any(sql.getMarketWorlds, {market: market.id});
                const openWorlds = marketWorlds.filter(world => world.open);

                for (const world of openWorlds) {
                    await processWorldHistory(world.world_id);
                }
            });
        }, untilMidnight);
    }
}

function getTimeUntilMidnight (timeOffset) {
    const now = utils.UTC() + timeOffset;
    const then = new Date(now);
    then.setHours(24, 0, 0, 0);
    return then - now;
}

async function processWorldHistory (worldId) {
    const historyLimit = config('sync', 'maximum_history_days');

    await db.task(async function (db) {
        debug.history('world:%s processing history', worldId);

        const players = await db.any(sql.getWorldData, {worldId, table: 'players', sort: 'id'});
        const tribes = await db.any(sql.getWorldData, {worldId, table: 'tribes', sort: 'id'});

        for (const player of players) {
            if (player.archived) {
                continue;
            }

            const history = await db.any(sql.getPlayerHistory, {worldId, playerId: player.id});

            if (history.length >= historyLimit) {
                let exceeding = history.length - historyLimit + 1;

                while (exceeding--) {
                    const {id} = history.pop();
                    await db.query(sql.deleteSubjectHistoryItem, {worldId, type: 'players', id});
                }
            }

            await db.query(sql.addPlayerHistoryItem, {
                worldId,
                id: player.id,
                tribe_id: player.tribe_id,
                points: player.points,
                villages: player.villages,
                rank: player.rank,
                victory_points: player.victory_points || null,
                bash_points_off: player.bash_points_off,
                bash_points_def: player.bash_points_def,
                bash_points_total: player.bash_points_total
            });
        }

        for (const tribe of tribes) {
            if (tribe.archived) {
                continue;
            }

            const history = await db.any(sql.getTribeHistory, {worldId, tribeId: tribe.id});

            if (history.length >= historyLimit) {
                let exceeding = history.length - historyLimit + 1;

                while (exceeding--) {
                    const {id} = history.pop();
                    await db.query(sql.deleteSubjectHistoryItem, {worldId, type: 'tribes', id});
                }
            }

            await db.query(sql.addTribeHistoryItem, {
                worldId,
                id: tribe.id,
                members: tribe.members,
                points: tribe.points,
                villages: tribe.villages,
                rank: tribe.rank,
                victory_points: tribe.victory_points || null,
                bash_points_off: tribe.bash_points_off,
                bash_points_def: tribe.bash_points_def,
                bash_points_total: tribe.bash_points_total
            });
        }
    });
}

function GenericSyncQueue () {
    const queue = [];
    let processing = false;
    let onFinish = async function () {};
    let onStart = async function () {};

    async function process () {
        processing = true;
        await onStart();
        while (queue.length) {
            const handler = queue.shift();
            await handler();
        }
        processing = false;
        await onFinish();
    }

    this.add = function (handler) {
        if (typeof handler === 'function') {
            queue.push(handler);
        }

        if (!processing) {
            process();
        }
    };

    this.onFinish = function (handler) {
        if (typeof handler === 'function') {
            onFinish = handler;
        }
    };

    this.onStart = function (handler) {
        if (typeof handler === 'function') {
            onStart = handler;
        }
    };
}

module.exports = Sync;
