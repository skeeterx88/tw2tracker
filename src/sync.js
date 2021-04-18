const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const humanInterval = require('human-interval');
const async = require('async');

const debug = require('./debug.js');
const {db, sql} = require('./db.js');
const utils = require('./utils.js');
const timeUtils = require('./time-utils.js');
const config = require('./config.js');
const Scraper = require('./scraper.js');

const syncCommands = require('./types/sync-commands.json');
const syncStatus = require('./types/sync-status.json');
const syncTypes = require('./types/sync-types.json');

const ACHIEVEMENT_COMMIT_ADD = 'achievement_commit_add';
const ACHIEVEMENT_COMMIT_UPDATE = 'achievement_commit_update';

const parallelData = config('sync', 'parallel_data_sync');
const parallelAchievements = config('sync', 'parallel_achievements_sync');

const historyQueue = async.queue(async handler => await handler(), 1);
const syncQueue = {};

const worldScrapers = new Map();

const syncTypeMapping = {
    [syncTypes.DATA]: {
        MAX_RUNNING_TIME: humanInterval(config('sync', 'max_sync_data_running_time')),
        UPDATE_LAST_SYNC_QUERY: sql('update-data-sync')
    },
    [syncTypes.ACHIEVEMENTS]: {
        MAX_RUNNING_TIME: humanInterval(config('sync', 'max_sync_achievements_running_time')),
        UPDATE_LAST_SYNC_QUERY: sql('update-achievements-sync')
    }
};

async function getScraper (marketId, worldNumber) {
    const worldId = marketId + worldNumber;

    if (worldScrapers.has(worldId)) {
        return worldScrapers.get(worldId);
    }

    const scraper = new Scraper(marketId, worldNumber);

    scraper.onKill(function () {
        worldScrapers.delete(worldId);
    });

    worldScrapers.set(worldId, scraper);

    return scraper;
}

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
        case syncCommands.DATA_RESET_QUEUE: {
            await db.none(sql('reset-queue-items-type'), {type: syncTypes.DATA});
            syncQueue[syncTypes.DATA].kill();
            syncQueue[syncTypes.DATA] = createSyncQueue(parallelData);
            break;
        }
        case syncCommands.ACHIEVEMENTS_RESET_QUEUE: {
            await db.none(sql('reset-queue-items-type'), {type: syncTypes.ACHIEVEMENTS});
            syncQueue[syncTypes.ACHIEVEMENTS].kill();
            syncQueue[syncTypes.ACHIEVEMENTS] = createSyncQueue(parallelAchievements);
            break;
        }
    }
}

async function initSyncQueue () {
    debug.queue('initializing sync queue');

    syncQueue[syncTypes.DATA] = createSyncQueue(parallelData);
    syncQueue[syncTypes.ACHIEVEMENTS] = createSyncQueue(parallelAchievements);

    const queueData = await db.any(sql('get-sync-queue-type'), {type: syncTypes.DATA});
    const queueAchievements = await db.any(sql('get-sync-queue-type'), {type: syncTypes.ACHIEVEMENTS});

    await db.none(sql('reset-queue-items-type'), {type: syncTypes.DATA});
    await db.none(sql('reset-queue-items-type'), {type: syncTypes.ACHIEVEMENTS});

    await addSyncQueue(syncTypes.DATA, queueData);
    await addSyncQueue(syncTypes.ACHIEVEMENTS, queueAchievements);
}

/**
 * @typedef {Object} QueueItem
 * @property {String} market_id
 * @property {Number} world_number
 */

/**
 * @param {String} type
 * @param {Array<QueueItem>} newItems
 * @return {Promise<void>}
 */
async function addSyncQueue (type, newItems) {
    if (!Array.isArray(newItems)) {
        throw new TypeError('Argument newItems must be an Array');
    }

    const queue = syncQueue[type];

    for (const item of newItems) {
        const worldId = item.market_id + item.world_number;
        const active = queue.workersList().some(worker => worker.data.worldId === worldId);

        if (active) {
            continue;
        }

        const {id} = await db.one(sql('add-sync-queue'), {type, ...item});

        queue.push({
            id,
            worldId,
            handler: function () {
                db.none(sql('set-queue-item-active'), {id});
                return syncWorld(type, item.market_id, item.world_number);
            }
        }, function () {
            db.none(sql('remove-sync-queue'), {id});
        });
    }
}

async function syncWorld (type, marketId, worldNumber) {
    const syncTypeValues = syncTypeMapping[type];
    const worldId = marketId + worldNumber;
    let scraper;
    let finished = false;
    let timeoutId;

    function finishSync (status) {
        clearTimeout(timeoutId);
        finished = true;
        db.none(syncTypeValues.UPDATE_LAST_SYNC_QUERY, {status, worldId});
    }

    const syncPromise = new Promise(async function (resolve, reject) {
        timeoutId = setTimeout(function () {
            reject(syncStatus.TIMEOUT);
        }, syncTypeValues.MAX_RUNNING_TIME);

        const world = await getOpenWorld(worldId);
        const marketAccounts = await db.any(sql('get-market-accounts'), {marketId});

        if (!world.sync_enabled) {
            return reject(syncStatus.NOT_ENABLED);
        }

        if (!marketAccounts.length) {
            return reject(syncStatus.NO_ACCOUNTS);
        }

        debug.sync('world:%s start %s sync', worldId, type);

        scraper = await getScraper(marketId, worldNumber);
        const account = await scraper.auth();

        if (!account) {
            return reject(syncStatus.ALL_ACCOUNTS_FAILED);
        }

        const character = account.characters.find(({world_id}) => world_id === worldId);
        let characterId;

        if (character) {
            characterId = character.character_id;
        } else if (!character) {
            const created = await scraper.createCharacter(worldNumber);
            if (created.id) {
                characterId = created.id;
            }
        } else if (!character.allow_login) {
            return reject(syncStatus.WORLD_CLOSED);
        }

        const selected = await scraper.selectCharacter(characterId);

        if (!selected) {
            return reject(syncStatus.FAILED_TO_SELECT_CHARACTER);
        }

        if (finished) {
            return;
        }

        debug.sync('world:%s fetching %s', worldId, type);

        switch (type) {
            case syncTypes.DATA: {
                const data = await scraper.data();
                await commitDataDatabase(data, worldId);
                await commitDataFilesystem(worldId);

                if (config('sync', 'store_raw_data')) {
                    await commitRawDataFilesystem(data, worldId);
                }
                break;
            }
            case syncTypes.ACHIEVEMENTS: {
                const data = await scraper.achievements();
                await commitAchievementsDatabase(data, worldId);

                if (config('sync', 'store_raw_data')) {
                    await commitRawAchievementsFilesystem(data, worldId);
                }
                break;
            }
        }

        resolve(syncStatus.SUCCESS);
    });

    return syncPromise.then(function (status) {
        finishSync(status);
        debug.sync('world:%s data %s finished', worldId, type);
    }).catch(function (status) {
        finishSync(status);
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
                scraper.kill();
                break;
            }
            case syncStatus.ALL_ACCOUNTS_FAILED: {
                debug.sync('world:%s all accounts failed to authenticate', worldId);
                break;
            }
            case syncStatus.WORLD_CLOSED: {
                debug.sync('world:%s closing', worldId);
                db.query(sql('close-world'), [marketId, worldNumber]);
                break;
            }
            case syncStatus.FAILED_TO_SELECT_CHARACTER: {
                debug.sync('world:%s failed to select character', worldId);
                break;
            }
            default: {
                throw status;
            }
        }
    });
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

        // TODO: allow to create scrapers with identifiers other than marketId + worldNumber.
        const scraper = await getScraper(marketId, marketId);
        const account = await scraper.auth();

        if (!account) {
            scraper.kill();
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
                await scraper.createCharacter(worldNumber);
            }

            const {exists: worldExists} = await db.one(sql('world-exists'), {worldId});

            if (!worldExists) {
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

        scraper.kill();
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

async function toggleWorld (marketId, worldNumber) {
    const worldId = marketId + worldNumber;
    const world = await getOpenWorld(worldId);
    const enabled = !world.sync_enabled;

    await db.query(sql('sync-toggle-world'), {
        marketId,
        worldNumber,
        enabled
    });

    return true;
}

// async function createAccounts (name, pass, mail) {
//     const markets = await db.any(sql('get-markets'));
//
//     for (const market of markets) {
//         const urlId = market.id === 'zz' ? 'beta' : market.id;
//         const page = await createPuppeteerPage();
//         await page.goto(`https://${urlId}.tribalwars2.com/page`, {
//             waitUntil: ['domcontentloaded', 'networkidle2']
//         });
//
//         const created = await page.evaluate(function (name, mail, pass, marketId) {
//             return new Promise(function (resolve, reject) {
//                 setTimeout(function () {
//                     const socketService = injector.get('socketService');
//                     const routeProvider = injector.get('routeProvider');
//
//                     debug('market:%s emit create account command', marketId);
//
//                     const timeout = setTimeout(function () {
//                         reject(false);
//                     }, 20000);
//
//                     socketService.emit(routeProvider.REGISTER, {
//                         name,
//                         mail,
//                         pass,
//                         pass_wh: pass,
//                         agb: true,
//                         invite_key: '',
//                         newsletter: false,
//                         platform: 'browser',
//                         portal_data: `portal_tid=${Date.now()}-${Math.round(Math.random() * 100000)}`,
//                         start_page_type: 'game_v1'
//                     }, function () {
//                         clearTimeout(timeout);
//                         resolve(true);
//                     });
//                 }, 1000);
//             });
//         }, name, mail, pass, market.id);
//
//         await page.close();
//
//         if (created) {
//             debug.sync('market:%s account "%s" created', market.id, name);
//
//             const [exists] = await db.any(sql('get-account-by-name'), {name});
//             const {id} = exists ? exists : await db.one(sql('add-account'), {name, pass});
//             await db.query(sql('add-account-market'), {accountId: id, marketId: market.id});
//         } else {
//             debug.sync('market:%s fail creating account "%s"', market.id, name);
//         }
//     }
// }

async function commitDataDatabase (data, worldId) {
    debug.db('world:%s commit db data', worldId);

    db.tx(async function (tx) {
        const oldPlayers = new Map(await tx.map(sql('get-active-subjects'), {worldId, type: 'players'}, subject => [subject.id, subject]));
        const oldTribes = new Map(await tx.map(sql('get-active-subjects'), {worldId, type: 'tribes'}, subject => [subject.id, subject]));
        const oldVillages = new Map(await tx.map(sql('get-world-villages'), {worldId}, subject => [subject.id, subject]));
        const oldPlayerRecords = new Map(await tx.map(sql('get-subject-records'), {worldId, type: 'players'}, subject => [subject.id, [subject.best_rank, subject.best_points, subject.best_villages]]));
        const oldTribeRecords = new Map(await tx.map(sql('get-subject-records'), {worldId, type: 'tribes'}, subject => [subject.id, [subject.best_rank, subject.best_points, subject.best_villages]]));

        async function updateSubjectsData () {
            for (const [id, subject] of data.tribes.entries()) {
                if (oldTribes.has(id)) {
                    await tx.none(sql('update-tribe'), {worldId, id, ...subject});
                } else {
                    await tx.none(sql('add-tribe'), {worldId, id, ...subject});
                }
            }

            for (const [id, subject] of data.players.entries()) {
                if (oldPlayers.has(id)) {
                    await tx.none(sql('update-player'), {worldId, id, ...subject});
                } else {
                    await tx.none(sql('add-player'), {worldId, id, ...subject});
                }
            }
        }

        async function updateConquests () {
            for (const [village_id, village] of data.villages.entries()) {
                const oldVillage = oldVillages.has(village_id)
                    ? oldVillages.get(village_id)
                    : {village_id, ...village};

                if (village.character_id !== oldVillage.character_id && village.character_id) {
                    const newOwnerId = village.character_id;
                    const newOwner = data.players.get(newOwnerId);
                    const oldOwner = data.villages.has(village_id) ? null : data.players.get(oldVillage.character_id);
                    const oldOwnerId = oldOwner ? oldVillage.character_id : null;

                    const tribeData = {
                        new_owner_tribe_id: null,
                        new_owner_tribe_tag_then: null,
                        old_owner_tribe_id: null,
                        old_owner_tribe_tag_then: null
                    };

                    if (newOwner.tribe_id) {
                        tribeData.new_owner_tribe_id = newOwner.tribe_id;
                        tribeData.new_owner_tribe_tag_then = data.tribes.get(newOwner.tribe_id).tag;
                    }

                    if (oldOwner && oldOwner.tribe_id) {
                        tribeData.old_owner_tribe_id = oldOwner.tribe_id;
                        tribeData.old_owner_tribe_tag_then = data.tribes.get(oldOwner.tribe_id).tag;
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
                if (!data.players.has(id)) {
                    await tx.none(sql('archive-player'), {worldId, id});
                }
            }

            for (const id of oldTribes.keys()) {
                if (!data.tribes.has(id)) {
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
                for (const [id, subject] of data[type].entries()) {
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
            for (const [province_name, province_id] of data.provinces.entries()) {
                await tx.none(sql('add-province'), {worldId, province_id, province_name});
            }
        }

        async function updateVillages () {
            for (const [village_id, village] of data.villages.entries()) {
                await tx.none(sql('add-village'), {worldId, village_id, ...village});
            }
        }

        async function updateTribeMemberChanges () {
            for (const [character_id, playerNewData] of data.players.entries()) {
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
            for (const [character_id, villages_id] of data.villagesByPlayer.entries()) {
                await tx.none(sql('update-player-villages'), {worldId, character_id, villages_id});
            }
        }

        async function updateSubjectAvgCoords () {
            const players = {};
            const tribes = {};

            for (const [playerId, villageIds] of data.villagesByPlayer.entries()) {
                if (!villageIds.length) {
                    continue;
                }

                let sumX = 0;
                let sumY = 0;

                for (const vid of villageIds) {
                    const {x, y} = data.villages.get(vid);
                    sumX += x;
                    sumY += y;
                }

                const avgX = Math.floor(sumX / villageIds.length);
                const avgY = Math.floor(sumY / villageIds.length);

                players[playerId] = [avgX, avgY];
            }

            for (const [tribeId, tribeMembers] of data.playersByTribe.entries()) {
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
                villages: data.villages.size,
                players: data.players.size,
                tribes: data.tribes.size
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

    const plainData = {};

    for (const [type, value] of Object.entries(data)) {
        plainData[type] = Array.from(value);
    }

    const location = path.join('.', 'data', 'raw');
    await fs.promises.mkdir(location, {recursive: true});
    await fs.promises.writeFile(path.join(location, `${worldId}.json`), JSON.stringify(plainData));
}

async function commitRawAchievementsFilesystem (achievements, worldId) {
    debug.sync('world:%s commit fs raw achievements', worldId);

    const location = path.join('.', 'data', 'raw');
    await fs.promises.mkdir(location, {recursive: true});
    await fs.promises.writeFile(path.join(location, `${worldId}-achievements.json`), JSON.stringify(achievements));
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
        historyQueue.push(async function () {
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

    for (const [subjectId, newAchievementsRaw] of achievements.entries()) {
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
    const now = timeUtils.UTC() + timeOffset;
    const then = new Date(now);
    then.setHours(24, 0, 0, 0);
    return then - now;
}

/**
 * @param {Number} concurrent Number of workers running in parallel.
 */
function createSyncQueue (concurrent) {
    return async.queue(async function (task, callback) {
        debug.queue('world:%s start (queue id %d)', task.worldId, task.id);
        await task.handler();
        callback();
        debug.queue('world:%s finish (queue id %d)', task.worldId, task.id);
    }, concurrent);
}

module.exports = {
    init,
    trigger
};
