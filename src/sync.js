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

const ACHIEVEMENT_COMMIT_ADD = 'achievement_commit_add';
const ACHIEVEMENT_COMMIT_UPDATE = 'achievement_commit_update';

const auths = {};

const parallelData = config('sync', 'parallel_data_sync');
const parallelAchievements = config('sync', 'parallel_achievements_sync');

const historyQueue = new GenericQueue();
const dataQueue = new GenericQueue(parallelData);
const achievementsQueue = new GenericQueue(parallelAchievements);

let browser = null;

const syncTypes = {
    DATA: 'data',
    ACHIEVEMENTS: 'achievements'
};

const syncTypeMapping = {
    [syncTypes.DATA]: {
        queue: dataQueue,
        activeWorlds: new Set(),
        MAX_RUNNING_TIME_CONFIG: 'max_sync_data_running_time',
        FINISH_EVENT: syncEvents.DATA_FINISH,
        UPDATE_LAST_SYNC_QUERY: sql('update-data-sync')
    },
    [syncTypes.ACHIEVEMENTS]: {
        queue: achievementsQueue,
        activeWorlds: new Set(),
        MAX_RUNNING_TIME_CONFIG: 'max_sync_achievements_running_time',
        FINISH_EVENT: syncEvents.ACHIEVEMENTS_FINISH,
        UPDATE_LAST_SYNC_QUERY: sql('update-achievements-sync')
    }
};

async function init () {
    debug.sync('initializing sync system');

    process.on('SIGTERM', async function () {
        await db.$pool.end();
        process.exit(0);
    });

    await initSyncQueue();

    const markets = await db.any(sql('get-markets'));
    const worlds = await db.any(sql('get-worlds'));

    if (!markets.length) {
        await syncMarketList();
    }

    if (!worlds.length) {
        await syncWorldList();
        await syncAllWorlds(syncTypes.DATA);
    }

    if (process.env.NODE_ENV !== 'development') {
        await initTasks();
        await initHistoryQueue();
    }
}

async function trigger (msg) {
    switch (msg.command) {
        case syncCommands.DATA_ALL: {
            await syncAllWorlds(syncTypes.DATA);
            break;
        }
        case syncCommands.DATA: {
            await addSyncQueue(syncTypes.DATA, [{
                market_id: msg.marketId,
                world_number: msg.worldNumber
            }]);
            break;
        }
        case syncCommands.ACHIEVEMENTS_ALL: {
            await syncAllWorlds(syncTypes.ACHIEVEMENTS);
            break;
        }
        case syncCommands.ACHIEVEMENTS: {
            await addSyncQueue(syncTypes.ACHIEVEMENTS, [{
                market_id: msg.marketId,
                world_number: msg.worldNumber
            }]);
            break;
        }
        case syncCommands.MARKETS: {
            await syncMarketList();
            break;
        }
        case syncCommands.WORLDS: {
            await syncWorldList();
            break;
        }
        case syncCommands.TOGGLE: {
            await toggleWorld(msg.marketId, msg.worldNumber);
            break;
        }
    }
}

async function initSyncQueue () {
    debug.queue('initializing sync queue');

    await db.none(sql('reset-queue-items'));

    const dataQueue = await db.any(sql('get-sync-queue-type'), {type: syncTypes.DATA});
    const achievementsQueue = await db.any(sql('get-sync-queue-type'), {type: syncTypes.ACHIEVEMENTS});

    await addSyncQueue(syncTypes.DATA, dataQueue, true);
    await addSyncQueue(syncTypes.ACHIEVEMENTS, achievementsQueue, true);
}

async function addSyncQueue (type, newItems, restore = false) {
    if (!Array.isArray(newItems)) {
        throw new TypeError('Argument newItems must be an Array');
    }

    const {queue} = syncTypeMapping[type];

    for (let item of newItems) {
        debug.queue('add world:%s%s type:%s', item.market_id, item.world_number, type);

        if (!restore) {
            item = await db.one(sql('add-sync-queue'), {
                type,
                market_id: item.market_id,
                world_number: item.world_number
            });
        }

        queue.add(async function () {
            await db.none(sql('set-queue-item-active'), {id: item.id, active: true});
            await syncWorld(type, item.market_id, item.world_number);
            await db.none(sql('remove-sync-queue'), {id: item.id});
        });
    }
}

async function syncWorld (type, marketId, worldNumber) {
    const syncTypeValues = syncTypeMapping[type];
    const worldId = marketId + worldNumber;
    const urlId = marketId === 'zz' ? 'beta' : marketId;
    const maxRunningTime = config('sync', syncTypeValues.MAX_RUNNING_TIME_CONFIG);

    let page = false;

    const promise = new Promise(async function (resolve, reject) {
        if (syncTypeValues.activeWorlds.has(worldId)) {
            return reject(syncStatus.IN_PROGRESS);
        }

        syncTypeValues.activeWorlds.add(worldId);

        const market = await db.one(sql('get-market'), {marketId});
        const world = await getOpenWorld(worldId);
        const marketAccounts = await db.any(sql('get-market-accounts'), {marketId});

        if (!world.sync_enabled) {
            return reject(syncStatus.NOT_ENABLED);
        }

        if (!marketAccounts.length) {
            return reject(syncStatus.NO_ACCOUNTS);
        }

        debug.sync('world:%s start %s sync', worldId, type);

        await utils.timeout(async function () {
            const account = await authMarketAccount(marketId);

            if (!account) {
                return reject(syncStatus.ALL_ACCOUNTS_FAILED);
            }

            const character = account.characters.find(({world_id}) => world_id === worldId);

            if (!character) {
                await createCharacter(marketId, worldNumber);
            } else if (!character.allow_login) {
                return reject(syncStatus.WORLD_CLOSED);
            }

            page = await createPuppeteerPage();

            await page.goto(`https://${urlId}.tribalwars2.com/game.php?world=${worldId}&character_id=${account.player_id}`, {
                waitFor: ['domcontentloaded', 'networkidle2']
            });

            debug.sync('world:%s waiting ready state', worldId);

            await page.evaluate(scraperReadyState, {
                timeout: humanInterval(config('sync_timeouts', 'ready_state'))
            });

            switch (type) {
                case syncTypes.DATA: {
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

                    const scraperConfig = {
                        loadContinentTimeout: humanInterval(config('sync_timeouts', 'load_continent')),
                        loadContinentSectionTimeout: humanInterval(config('sync_timeouts', 'load_continent_section'))
                    };

                    const data = await page.evaluate(scraperData, scraperConfig);
                    await commitRawDataFilesystem(data, worldId);
                    await commitDataDatabase(data, worldId);
                    await commitDataFilesystem(worldId);
                    break;
                }
                case syncTypes.ACHIEVEMENTS: {
                    debug.sync('world:%s fetching achievements', worldId);

                    const achievements = await page.evaluate(scraperAchievements, marketId, worldNumber);
                    await commitRawAchievementsFilesystem(achievements, worldId);
                    await commitAchievementsDatabase(achievements, worldId);
                    break;
                }
            }

            resolve(syncStatus.SUCCESS);
        }, maxRunningTime).catch(function (error) {
            if (error.timeout) {
                reject(syncStatus.TIMEOUT);
            } else {
                throw error;
            }
        });
    });

    const finish = async function (status) {
        Events.trigger(syncTypeValues.FINISH_EVENT, [worldId, status]);
        syncTypeValues.activeWorlds.delete(worldId);
        await db.none(syncTypeValues.UPDATE_LAST_SYNC_QUERY, {status, worldId});

        switch (status) {
            case syncStatus.IN_PROGRESS: {
                debug.sync('world:%s sync in progress', worldId);
                break;
            }
            case syncStatus.NOT_ENABLED: {
                debug.sync('world:%s not enabled', worldId);
                break;
            }
            case syncStatus.NO_ACCOUNTS: {
                debug.sync('market:%s does not have any sync accounts', marketId);
                break;
            }
            case syncStatus.TIMEOUT: {
                debug.sync('world:%s timeout', worldId);
                break;
            }
            case syncStatus.ALL_ACCOUNTS_FAILED: {
                debug.sync('world:%s all accounts failed to authenticate', worldId);
                break;
            }
            case syncStatus.WORLD_CLOSED: {
                debug.sync('world:%s closing', worldId);
                await db.query(sql('close-world'), [marketId, worldNumber]);
                break;
            }
            case syncStatus.SUCCESS: {
                debug.sync('world:%s data %s finished', worldId, type);
                break;
            }
        }

        if (page) {
            await page.close();
        }
    };

    return promise
        .then(finish)
        .catch(finish);
}

async function syncAllWorlds (type) {
    const syncQueue = await db.map(sql('get-sync-queue-non-active'), {type}, ({market_id, world_number}) => market_id + world_number);
    const worlds = await db.map(sql('get-sync-enabled-worlds'), [], function (world) {
        return !syncQueue.includes(world.world_id) ? {market_id: world.market, world_number: world.num} : false;
    });
    const uniqueWorlds = worlds.filter(world => world !== false);
    await addSyncQueue(type, uniqueWorlds);
}

async function syncWorldList () {
    debug.worlds('start world list sync');

    const markets = await db.any(sql('get-markets'));

    for (const market of markets) {
        const marketId = market.id;

        debug.worlds('market:%s check missing worlds', marketId);

        try {
            const account = await authMarketAccount(marketId);

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
                    await createCharacter(marketId, worldNumber);
                }

                if (!await utils.worldEntryExists(worldId)) {
                    debug.worlds('world:%s creating world db entry', worldId);

                    await db.query(sql('create-world-schema'), {
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
}

async function syncMarketList () {
    debug.sync('start market list sync');

    const storedMarkets = await db.map(sql('get-markets'), [], market => market.id);
    const $portalBar = await utils.getHTML('https://tribalwars2.com/portal-bar/https/portal-bar.html');
    const $markets = $portalBar.querySelectorAll('.pb-lang-sec-options a');

    const marketList = $markets.map(function ($market) {
        const market = $market.attributes.href.split('//')[1].split('.')[0];
        return market === 'beta' ? 'zz' : market;
    });

    const missingMarkets = marketList.filter(marketId => !storedMarkets.includes(marketId));

    for (const marketId of missingMarkets) {
        await db.query(sql('add-market'), {marketId});
    }

    return missingMarkets;
}

async function createCharacter (marketId, worldNumber) {
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
}

async function authMarketAccount (marketId, attempt = 1) {
    if (auths[marketId]) {
        return await auths[marketId];
    }

    let page;

    try {
        auths[marketId] = utils.timeout(async function () {
            const accounts = await db.any(sql('get-market-accounts'), {marketId});

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
            return await authMarketAccount(marketId, attempt + 1);
        } else {
            debug.auth('market:%s authentication failed (maximum attempts reached)');
            throw new Error(error.message);
        }
    }
}

async function toggleWorld (marketId, worldNumber) {
    const worldId = marketId + worldNumber;
    const world = await getOpenWorld(worldId);
    const enabled = !world.sync_enabled;

    await db.query(sql('sync-toggle-world'), {
        marketId,
        worldNumber,
        enabled
    });

    Events.trigger(syncEvents.TOGGLE_WORLD, [marketId, worldNumber, enabled]);

    return true;
}

async function createAccounts (name, pass, mail) {
    const markets = await db.any(sql('get-markets'));

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
                        reject(false);
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

            const [exists] = await db.any(sql('get-account-by-name'), {name});
            const {id} = exists ? exists : await db.one(sql('add-account'), {name, pass});
            await db.query(sql('add-account-market'), {accountId: id, marketId: market.id});
        } else {
            debug.sync('market:%s fail creating account "%s"', market.id, name);
        }
    }
}

async function commitDataDatabase (data, worldId) {
    debug.db('world:%s commit db data', worldId);

    db.tx(async function (tx) {
        const oldPlayers = new Map(await tx.map(sql('get-active-subjects'), {worldId, type: 'players'}, subject => [subject.id, subject]));
        const oldTribes = new Map(await tx.map(sql('get-active-subjects'), {worldId, type: 'tribes'}, subject => [subject.id, subject]));
        const oldVillages = new Map(await tx.map(sql('get-world-villages'), {worldId}, subject => [subject.id, subject]));
        const oldPlayerRecords = new Map(await tx.map(sql('get-subject-records'), {worldId, type: 'players'}, subject => [subject.id, [subject.best_rank, subject.best_points, subject.best_villages]]));
        const oldTribeRecords = new Map(await tx.map(sql('get-subject-records'), {worldId, type: 'tribes'}, subject => [subject.id, [subject.best_rank, subject.best_points, subject.best_villages]]));

        const newPlayers = new Map(data.players);
        const newTribes = new Map(data.tribes);
        const newVillages = new Map(data.villages);

        async function updateSubjectsData () {
            for (const [id, subject] of data.tribes) {
                if (oldTribes.has(id)) {
                    await tx.none(sql('update-tribe'), {worldId, id, ...subject});
                } else {
                    await tx.none(sql('add-tribe'), {worldId, id, ...subject});
                }
            }

            for (const [id, subject] of data.players) {
                if (oldPlayers.has(id)) {
                    await tx.none(sql('update-player'), {worldId, id, ...subject});
                } else {
                    await tx.none(sql('add-player'), {worldId, id, ...subject});
                }
            }
        }

        async function updateConquests () {
            for (const [village_id, village] of newVillages.entries()) {
                const oldVillage = oldVillages.has(village_id)
                    ? oldVillages.get(village_id)
                    : {village_id, ...village};

                if (village.character_id !== oldVillage.character_id && village.character_id) {
                    const newOwnerId = village.character_id;
                    const newOwner = newPlayers.get(newOwnerId);
                    const oldOwner = newVillages.has(village_id) ? null : newPlayers.get(oldVillage.character_id);
                    const oldOwnerId = oldOwner ? oldVillage.character_id : null;

                    const tribeData = {
                        new_owner_tribe_id: null,
                        new_owner_tribe_tag_then: null,
                        old_owner_tribe_id: null,
                        old_owner_tribe_tag_then: null
                    };

                    if (newOwner.tribe_id) {
                        tribeData.new_owner_tribe_id = newOwner.tribe_id;
                        tribeData.new_owner_tribe_tag_then = newTribes.get(newOwner.tribe_id).tag;
                    }

                    if (oldOwner && oldOwner.tribe_id) {
                        tribeData.old_owner_tribe_id = oldOwner.tribe_id;
                        tribeData.old_owner_tribe_tag_then = newTribes.get(oldOwner.tribe_id).tag;
                    }

                    await tx.none(sql('add-conquest'), {
                        worldId,
                        village_id,
                        newOwner: newOwnerId,
                        oldOwner: oldOwnerId,
                        village_points_then: village.points,
                        ...tribeData
                    });
                }
            }
        }

        async function updateMissingSubjects () {
            for (const id of oldPlayers.keys()) {
                if (!newPlayers.has(id)) {
                    await tx.none(sql('archive-player'), {worldId, id});
                }
            }

            for (const id of oldTribes.keys()) {
                if (!newTribes.has(id)) {
                    await tx.none(sql('archive-tribe'), {worldId, id});
                }
            }
        }

        async function updateSubjectsRecords () {
            const oldRecords = {
                players: oldPlayerRecords,
                tribes: oldTribeRecords
            };

            for (const type of ['tribes', 'players']) {
                for (const [id, subject] of data[type]) {
                    const [bestRank, bestPoints, bestVillages] = oldRecords[type].get(id) || [];

                    if (!bestRank || subject.rank <= bestRank) {
                        await tx.none(sql('update-subject-record'), {worldId, type, recordType: 'rank', id, value: subject.rank});
                    }

                    if (!bestPoints || subject.points >= bestPoints) {
                        await tx.none(sql('update-subject-record'), {worldId, type, recordType: 'points', id, value: subject.points});
                    }

                    if (!bestVillages || subject.villages >= bestVillages) {
                        await tx.none(sql('update-subject-record'), {worldId, type, recordType: 'villages', id, value: subject.villages});
                    }
                }
            }
        }

        async function updateProvinces () {
            for (const [province_name, province_id] of data.provinces) {
                await tx.none(sql('add-province'), {worldId, province_id, province_name});
            }
        }

        async function updateVillages () {
            for (const [village_id, village] of data.villages) {
                await tx.none(sql('add-village'), {worldId, village_id, ...village});
            }
        }

        async function updateTribeMemberChanges () {
            for (const [character_id, playerNewData] of newPlayers.entries()) {
                const playerOldData = oldPlayers.get(character_id);

                const oldTribeId = playerOldData ? playerOldData.tribe_id : null;
                const newTribeId = playerNewData.tribe_id;

                if (oldTribeId !== newTribeId) {
                    const oldTribe = oldTribes.get(oldTribeId);
                    const newTribe = oldTribes.get(newTribeId);

                    await tx.none(sql('add-tribe-member-change'), {
                        worldId,
                        character_id,
                        old_tribe: oldTribeId,
                        new_tribe: newTribeId,
                        old_tribe_tag_then: oldTribe ? oldTribe.tag : null,
                        new_tribe_tag_then: newTribe ? newTribe.tag : null
                    });
                }
            }
        }

        async function updatePlayerVillages () {
            for (const [character_id, villages_id] of data.villagesByPlayer) {
                await tx.none(sql('update-player-villages'), {worldId, character_id, villages_id});
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
                    const {x, y} = newVillages.get(vid);
                    sumX += x;
                    sumY += y;
                }

                const avgX = Math.floor(sumX / villageIds.length);
                const avgY = Math.floor(sumY / villageIds.length);

                players[playerId] = [avgX, avgY];
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
                tribes[tribeId] = [avgX, avgY];
            }

            for (const [id, avg] of Object.entries(players)) {
                await tx.none(sql('update-subject-avg-coords'), {worldId, type: 'players', id, avg});
            }

            for (const [id, avg] of Object.entries(tribes)) {
                await tx.none(sql('update-subject-avg-coords'), {worldId, type: 'tribes', id, avg});
            }
        }

        async function updateWorldStats () {
            await tx.none(sql('update-world-stats'), {
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

        debug.db('world:%s commit db data finished', worldId);
    });
}

async function commitAchievementsDatabase (data, worldId) {
    debug.db('world:%s commit db achievements', worldId);

    const sqlSubjectMap = {
        players: {
            [ACHIEVEMENT_COMMIT_ADD]: sql('add-player-achievement'),
            [ACHIEVEMENT_COMMIT_UPDATE]: sql('update-player-achievement')
        },
        tribes: {
            [ACHIEVEMENT_COMMIT_ADD]: sql('add-tribe-achievement'),
            [ACHIEVEMENT_COMMIT_UPDATE]: sql('update-tribe-achievement')
        }
    };

    db.tx(async function (tx) {
        const log = {};

        for (const subjectType of ['players', 'tribes']) {
            const commits = await generateAchievementCommits(tx, subjectType, data[subjectType], worldId);

            for (const {commitType, achievement} of commits) {
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
                added: commits.filter(({commitType}) => commitType === ACHIEVEMENT_COMMIT_ADD).length,
                updated: commits.filter(({commitType}) => commitType === ACHIEVEMENT_COMMIT_UPDATE).length
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
        ] = await db.task(async tx => [
            await tx.one(sql('get-world'), {worldId}),
            await tx.any(sql('get-world-data'), {worldId, table: 'players', sort: 'rank'}),
            await tx.any(sql('get-world-data'), {worldId, table: 'villages', sort: 'points'}),
            await tx.any(sql('get-world-data'), {worldId, table: 'tribes', sort: 'rank'}),
            await tx.any(sql('get-world-data'), {worldId, table: 'provinces', sort: 'id'})
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

        await db.none(sql('update-world-config'), {
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

        await db.none(sql('update-market-time-offset'), {
            marketId,
            timeOffset
        });
    } catch (error) {
        debug.sync('market:%s error fetching timezone (%s)', marketId, error.message);
    }
}

// history

async function initHistoryQueue () {
    const markets = await db.any(sql('get-markets'));

    for (const market of markets) {
        queueMarketHistory(market.id);
    }
}

async function queueMarketHistory (marketId) {
    const market = await db.one(sql('get-market'), {marketId});
    const untilMidnight = getTimeUntilMidnight(market.time_offset);

    debug.history('market:%s history process starts in %i minutes', marketId, untilMidnight / 1000 / 60);

    setTimeout(function () {
        historyQueue.add(async function () {
            const marketWorlds = await db.any(sql('get-market-worlds'), {marketId});
            const openWorlds = marketWorlds.filter(world => world.open);

            for (const world of openWorlds) {
                await processWorldHistory(world.world_id);
            }

            await queueMarketHistory(marketId);
        });
    }, untilMidnight);
}

async function processWorldHistory (worldId) {
    const historyLimit = config('sync', 'maximum_history_days');

    await db.task(async function (tx) {
        debug.history('world:%s processing history', worldId);

        const players = await tx.any(sql('get-world-data'), {worldId, table: 'players', sort: 'id'});
        const tribes = await tx.any(sql('get-world-data'), {worldId, table: 'tribes', sort: 'id'});

        for (const player of players) {
            if (player.archived) {
                continue;
            }

            const history = await tx.any(sql('get-player-history'), {worldId, playerId: player.id, limit: historyLimit + 100});

            if (history.length >= historyLimit) {
                let exceeding = history.length - historyLimit + 1;

                while (exceeding--) {
                    const {id} = history.pop();
                    await tx.query(sql('delete-subject-history-item'), {worldId, type: 'players', id});
                }
            }

            await tx.query(sql('add-player-history-item'), {
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

            const history = await tx.any(sql('get-tribe-history'), {worldId, tribeId: tribe.id, limit: historyLimit + 100});

            if (history.length >= historyLimit) {
                let exceeding = history.length - historyLimit + 1;

                while (exceeding--) {
                    const {id} = history.pop();
                    await tx.query(sql('delete-subject-history-item'), {worldId, type: 'tribes', id});
                }
            }

            await tx.query(sql('add-tribe-history-item'), {
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

// tasks

async function initTasks () {
    debug.tasks('initializing task system');

    const taskHandlers = new Map();
    const intervalKeys = Object.keys(config('sync_intervals'));
    const presentTasks = await db.any(sql('get-tasks'));
    const interval = humanInterval(config('sync', 'task_check_interval'));

    for (const {id} of presentTasks) {
        if (!intervalKeys.includes(id)) {
            debug.tasks('task:%s add missing db entry', id);
            db.query(sql('add-task-if-missing'), {id});
        }
    }

    taskHandlers.set('data_all', function () {
        syncAllWorlds(syncTypes.DATA);
    });

    taskHandlers.set('achievements_all', function () {
        syncAllWorlds(syncTypes.ACHIEVEMENTS);
    });

    taskHandlers.set('worlds', async function () {
        await syncMarketList();
        await syncWorldList();
    });

    taskHandlers.set('clean_shares', async function () {
        const now = Date.now();
        const shares = await db.any(sql('maps/get-share-last-access'));
        const expireTime = humanInterval(config('sync', 'static_share_expire_time'));

        for (const {share_id, last_access} of shares) {
            if (now - last_access.getTime() < expireTime) {
                await db.query(sql('maps/delete-static-share'), [share_id]);
                // TODO: delete data as well
            }
        }
    });

    debug.tasks('start task checker (interval: %s)', config('sync', 'task_check_interval'));

    const intervalEntries = Object.entries(config('sync_intervals'));
    const parsedIntervals = intervalEntries.map(([id, readableInterval]) => [id, humanInterval(readableInterval)]);
    const mappedIntervals = new Map(parsedIntervals);

    async function checkTasks () {
        debug.tasks('checking tasks...');

        const lastRunEntries = await db.map(sql('get-tasks'), [], ({id, last_run}) => [id, last_run]);
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
            db.query(sql('update-task-last-run'), {id});
        }
    }

    setInterval(checkTasks, interval);
}

// helpers

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

async function getOpenWorld (worldId) {
    const [world] = await db.any(sql('get-world'), {worldId});

    if (!world) {
        throw new Error(`World ${worldId} not found.`);
    }

    if (!world.open) {
        throw new Error(`World ${worldId} is closed`);
    }

    return world;
}

async function generateAchievementCommits (tx, subjectType, achievements, worldId) {
    const achievementsToCommit = [];

    const sqlAchievementsMap = {
        players: sql('get-player-achievements'),
        tribes: sql('get-tribe-achievements')
    };

    for (const [subjectId, newAchievementsRaw] of achievements) {
        const achievementsToMerge = [];

        const oldAchievementsRaw = await tx.any(sqlAchievementsMap[subjectType], {worldId, id: subjectId});

        if (oldAchievementsRaw.length) {
            const oldAchievements = mapAchievements(oldAchievementsRaw);
            const newAchievements = mapAchievements(newAchievementsRaw);

            if (newAchievementsRaw.length > oldAchievementsRaw.length) {
                for (const type of newAchievements.unique.keys()) {
                    if (!oldAchievements.unique.has(type)) {
                        achievementsToMerge.push({
                            commitType: ACHIEVEMENT_COMMIT_ADD,
                            achievement: newAchievements.unique.get(type)
                        });
                    }
                }
            }

            for (const type of oldAchievements.unique.keys()) {
                if (newAchievements.unique.has(type) && newAchievements.unique.get(type).level > oldAchievements.unique.get(type).level) {
                    achievementsToMerge.push({
                        commitType: ACHIEVEMENT_COMMIT_UPDATE,
                        achievement: newAchievements.unique.get(type)
                    });
                }
            }

            for (const type of newAchievements.repeatable.keys()) {
                const newRepeatable = newAchievements.repeatable.get(type);
                const oldRepeatable = oldAchievements.repeatable.get(type);
                const missing = [];

                if (!oldRepeatable) {
                    missing.push(...newRepeatable);
                } else if (oldRepeatable.length !== newRepeatable.length) {
                    missing.push(...newRepeatable.slice(oldRepeatable.length, newRepeatable.length));
                }

                for (const achievement of missing) {
                    achievementsToMerge.push({
                        commitType: ACHIEVEMENT_COMMIT_ADD,
                        achievement
                    });
                }
            }
        } else {
            for (const achievement of newAchievementsRaw) {
                achievementsToMerge.push({
                    commitType: ACHIEVEMENT_COMMIT_ADD,
                    achievement
                });
            }
        }

        for (const commit of achievementsToMerge) {
            commit.achievement.id = subjectId;
            achievementsToCommit.push(commit);
        }
    }

    return achievementsToCommit;
}

function mapAchievements (achievements) {
    const unique = new Map;
    const repeatable = new Map();

    for (const achievement of achievements) {
        if (achievement.period) {
            if (!repeatable.has(achievement.type)) {
                repeatable.set(achievement.type, []);
            }

            repeatable.get(achievement.type).push(achievement);
        } else {
            unique.set(achievement.type, achievement);
        }
    }

    return {unique, repeatable};
}

function getTimeUntilMidnight (timeOffset) {
    const now = utils.UTC() + timeOffset;
    const then = new Date(now);
    then.setHours(24, 0, 0, 0);
    return then - now;
}

function GenericQueue (parallel = 1) {
    const queue = [];
    let active = false;
    let running = 0;

    function process () {
        active = true;

        const handler = queue.shift();

        if (handler) {
            running++;

            handler().finally(function () {
                running--;
                process();
            });

            if (running < parallel) {
                process();
            }
        } else {
            active = false;
        }
    }

    this.add = function (handler) {
        if (typeof handler === 'function') {
            queue.push(handler);

            if (!active) {
                process();
            }
        }
    };
}

module.exports = {
    init,
    trigger
};
