const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const humanInterval = require('human-interval');
const WebSocket = require('ws');
const async = require('async');

const debug = require('./debug.js');
const {db} = require('./db.js');
const sql = require('./sql.js');
const puppeteer = require('./puppeteer.js');
const utils = require('./utils.js');
const config = require('./config.js');
const Events = require('./events.js');
const userAgent = 'Mozilla/5.0%20(X11;%20Linux%20x86_64)%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)%20Chrome/89.0.4389.114%20Safari/537.36';
const MAP_CHUNK_SIZE = 25;
const RANKING_QUERY_COUNT = 25;
const worldsGameData = new Map();

const saveRawData = false;

const syncCommands = require('./sync-commands.json');
const syncStatus = require('./sync-status.json');
const syncEvents = require('./sync-events.json');
const syncTypes = require('./sync-types.json');

const ACHIEVEMENT_COMMIT_ADD = 'achievement_commit_add';
const ACHIEVEMENT_COMMIT_UPDATE = 'achievement_commit_update';

const parallelData = config('sync', 'parallel_data_sync');
const parallelAchievements = config('sync', 'parallel_achievements_sync');

const historyQueue = async.queue(async function (handler) {
    await handler();
}, 1);

const dataQueue = createSyncQueue(parallelData);
const achievementsQueue = createSyncQueue(parallelAchievements);

const worldScrapers = new Map();

let browser = null;

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

/**
 * @param marketId {String}
 * @param worldNumber {Number}
 */
function CreateScraper (marketId, worldNumber) {
    const worldId = marketId + worldNumber;

    const callbacks = new Map();
    const timeouts = new Map();

    const urlId = marketId === 'zz' ? 'beta' : marketId;
    const socket = new WebSocket(`wss://${urlId}.tribalwars2.com/socket.io/?platform=desktop&EIO=3&transport=websocket`);
    const LOADING_TIMEOUT = 10000;

    let authenticated = false;
    let characterSelected = false;
    let emitId = 1;
    let pingIntervalId;

    this.ready = new Promise(function (resolve) {
        socket.on('open', resolve);
    });

    /**
     * @param {String} type
     * @param {Object} [data]
     * @param {Function} [callback]
     * @return {Promise<Object>}
     */
    this.emit = function (type, data, callback) {
        return new Promise(async (resolve, reject) => {
            await this.ready;

            const id = emitId++;

            // debug.socket('world:%s emit #%i %s %o', worldId, id, type, data);

            socket.send('42' + JSON.stringify(['msg', {
                type,
                data,
                id,
                headers: {traveltimes: [['browser_send', Date.now()]]}
            }]));

            callbacks.set(id, function (data, eventId) {
                if (typeof callback === 'function') {
                    callback(data, eventId);
                    clearTimeout(timeouts.get(id));
                }

                // debug.socket('world:%s receive #%i %s', worldId, id, type);
                resolve(data);
            });

            if (typeof callback === 'function') {
                const timeoutId = setTimeout(function () {
                    callbacks.delete(id);
                    timeouts.delete(id);
                    reject(`socket emit id ${id} timed out. TRY AGAIN?!`);
                }, LOADING_TIMEOUT);

                timeouts.set(id, timeoutId);
            }
        });
    };

    this.kill = function () {
        clearTimeout(pingIntervalId);
        socket.close();
        worldScrapers.delete(worldId);
    };

    this.auth = async function () {
        if (authenticated) {
            return authenticated;
        }

        const accounts = await db.any(sql('get-market-accounts'), {marketId});

        if (!accounts.length) {
            debug.auth('market:%s do not have any accounts', marketId);
            return false;
        }

        while (accounts.length) {
            const account = accounts.shift();
            const result = await this.emit('Authentication/login', account);

            if (result.token) {
                debug.auth('market:%s account %s successed', marketId, account.name);
                authenticated = result;
                return result;
            } else if (result.code) {
                debug.auth('market:%s account %s failed: %s', marketId, account.name, result.code);
            }
        }

        return false;
    };

    this.selectCharacter = async (characterId) => {
        if (characterSelected) {
            return characterSelected;
        }

        const character = await this.emit('Authentication/selectCharacter', {
            world_id: worldId,
            id: characterId
        });

        if (character.error_code) {
            return false;
        }

        const gameData = await this.emit('GameDataBatch/getGameData');
        const characterInfo = await this.emit('Character/getInfo', {});

        worldsGameData.set(worldId, gameData);
        commitWorldConfig(gameData['WorldConfig/config'], worldId);

        let createVillageId;

        if (!characterInfo.villages.length) {
            const createdVillage = await this.emit('Character/createVillage', {
                name: character.name,
                direction: 'random'
            });

            createVillageId = createdVillage['village_id'];
        }

        await this.emit('Premium/listItems');
        await this.emit('GlobalInformation/getInfo');
        await this.emit('Effect/getEffects');
        await this.emit('TribeInvitation/getOwnInvitations');
        await this.emit('WheelEvent/getEvent');
        await this.emit('Character/getColors');
        await this.emit('Group/getGroups');
        await this.emit('Icon/getVillages');

        const worldConfig = gameData['WorldConfig/config'];

        if (worldConfig['tribe_skills']) {
            this.emit('TribeSkill/getInfo');
        }

        if (worldConfig['resource_deposits']) {
            this.emit('ResourceDeposit/getInfo');
        }

        this.emit('System/getTime', {}).then(function (data) {
            commitMarketTimeOffset(data.offset, marketId);
        });

        this.emit('DailyLoginBonus/getInfo', null);
        this.emit('Quest/getQuestLines');
        this.emit('Crm/getInterstitials', {device_type: 'desktop'});

        let village;

        if (createVillageId) {
            const villages = await this.emit('VillageBatch/getVillageData', {village_ids: [createVillageId]});
            village = villages[createVillageId]['Village/village'];
        } else {
            village = characterInfo.villages[0];
        }

        const coords = scaledGridCoordinates(village.x, village.y, 25, 25, MAP_CHUNK_SIZE);

        for (const [x, y] of coords) {
            this.emit('Map/getVillagesByArea', {
                x: x * MAP_CHUNK_SIZE,
                y: y * MAP_CHUNK_SIZE,
                width: MAP_CHUNK_SIZE,
                height: MAP_CHUNK_SIZE,
                character_id: characterId
            });
        }

        this.emit('System/startupTime', {startup_time: randomInteger(4000, 7000), platform: 'browser', device: userAgent});
        this.emit('InvitePlayer/getInfo');
        this.emit('VillageBatch/getVillageData', {village_ids: characterInfo.villages.map(village => village.id)});
        this.emit('SecondVillage/getInfo', {});
        this.emit('Authentication/completeLogin', {});

        characterSelected = character;

        return true;
    };

    function onMessage () {
        socket.on('message', function (raw) {
            const [,, json] = raw.match(/^(\d+)(.*)/);

            if (!json) {
                return;
            }

            const parsed = JSON.parse(json);

            if (parsed.sid) {
                pingIntervalId = setInterval(function () {
                    socket.send('2');
                }, parsed.pingInterval);

                return;
            }

            const msg = parsed[1];

            if (!msg.type) {
                return;
            }

            const id = parseInt(msg.id, 10);

            if (callbacks.has(id)) {
                const callback = callbacks.get(id);
                callbacks.delete(id);
                callback(msg.data, msg.type);
            }
        });
    }

    onMessage();

    this.ready.then(() => {
        this.emit('System/identify', {
            device: userAgent,
            api_version: '10.*.*',
            platform: 'browser'
        });
    });
}

async function createScraper (marketId, worldNumber) {
    const worldId = marketId + worldNumber;

    let scraper;

    if (worldScrapers.has(worldId)) {
        scraper = worldScrapers.get(worldId);
    } else {
        scraper = new CreateScraper(marketId, worldNumber);
        worldScrapers.set(worldId, scraper);
    }

    await scraper.ready;
    return scraper;
}

async function socketScrapeData (socket, worldId) {
    const CHUNK_SIZE = 50;
    const COORDS_REFERENCE = {
        topLeft: [[0, 0], [100, 0], [200, 0], [300, 0], [0, 100], [100, 100], [200, 100], [300, 100], [0, 200], [100, 200], [200, 200], [300, 200], [0, 300], [100, 300], [200, 300], [300, 300]],
        topRight: [[600, 0], [700, 0], [800, 0], [900, 0], [600, 100], [700, 100], [800, 100], [900, 100], [600, 200], [700, 200], [800, 200], [900, 200], [600, 300], [700, 300], [800, 300], [900, 300]],
        bottomLeft: [[0, 600], [100, 600], [200, 600], [300, 600], [0, 700], [100, 700], [200, 700], [300, 700], [0, 800], [100, 800], [200, 800], [300, 800], [0, 900], [100, 900], [200, 900], [300, 900]],
        bottomRight: [[600, 600], [700, 600], [800, 600], [900, 600], [600, 700], [700, 700], [800, 700], [900, 700], [600, 800], [700, 800], [800, 800], [900, 800], [600, 900], [700, 900], [800, 900], [900, 900]]
    };
    const BOUNDARIE_REFERENCE_COORDS = {
        left: [[400, 400], [400, 500], [300, 400], [300, 500], [200, 400], [200, 500], [100, 400], [100, 500], [0, 400], [0, 500]],
        right: [[500, 400], [500, 500], [600, 400], [600, 500], [700, 400], [700, 500], [800, 400], [800, 500], [900, 400], [900, 500]],
        top: [[400, 300], [500, 300], [400, 200], [500, 200], [400, 100], [500, 100], [400, 0], [500, 0]],
        bottom: [[400, 600], [500, 600], [400, 700], [500, 700], [400, 800], [500, 800], [400, 900], [500, 900]]
    };

    const playersByTribe = new Map();
    const villagesByPlayer = new Map();
    const villages = new Map();
    const tribes = new Map();
    const players = new Map();
    const provinces = new Map();
    const playersAchievement = new Map();

    const getBoundaries = async function () {
        const boundaries = {
            left: 500,
            right: 500,
            top: 500,
            bottom: 500
        };

        for (const side of ['left', 'right', 'top', 'bottom']) {
            for (let i = 0; i < BOUNDARIE_REFERENCE_COORDS[side].length; i++) {
                const [x, y] = BOUNDARIE_REFERENCE_COORDS[side][i];

                if (await loadContinent(x, y) === 0) {
                    break;
                }

                boundaries[side] = (side === 'left' || side === 'right') ? x : y;
            }
        }

        return boundaries;
    };

    const filterBlocks = function (boundaries) {
        return [
            ...COORDS_REFERENCE.topLeft.filter(([x, y]) => x >= boundaries.left && y >= boundaries.top),
            ...COORDS_REFERENCE.topRight.filter(([x, y]) => x <= boundaries.right && y >= boundaries.top),
            ...COORDS_REFERENCE.bottomLeft.filter(([x, y]) => x >= boundaries.left && y <= boundaries.bottom),
            ...COORDS_REFERENCE.bottomRight.filter(([x, y]) => x <= boundaries.right && y <= boundaries.bottom)
        ];
    };

    const loadVillageSection = async function (x, y) {
        const section = await socket.emit('Map/getVillagesByArea', {x, y, width: CHUNK_SIZE, height: CHUNK_SIZE});
        processVillages(section.villages);
        return section.villages.length;
    };

    const loadContinent = async function (x, y) {
        const loadVillages = await Promise.all([
            loadVillageSection(x, y),
            loadVillageSection(x + CHUNK_SIZE, y),
            loadVillageSection(x, y + CHUNK_SIZE),
            loadVillageSection(x + CHUNK_SIZE, y + CHUNK_SIZE)
        ]);

        return loadVillages.reduce((sum, value) => sum + value);
    };

    const processVillages = function (rawVillages) {
        if (!rawVillages.length) {
            return;
        }

        for (const village of rawVillages) {
            let province_id;

            if (provinces.has(village.province_name)) {
                province_id = provinces.get(village.province_name);
            } else {
                province_id = provinces.size;
                provinces.set(village.province_name, province_id);
            }

            villages.set(village.id, {
                x: village.x,
                y: village.y,
                name: village.name,
                points: village.points,
                character_id: village.character_id || null,
                province_id
            });
        }
    };

    const loadTribes = async function (offset) {
        const data = await socket.emit('Ranking/getTribeRanking', {
            area_type: 'world',
            offset,
            count: RANKING_QUERY_COUNT,
            order_by: 'rank',
            order_dir: 0,
            query: ''
        });

        for (const tribe of data.ranking) {
            tribes.set(tribe.tribe_id, {
                bash_points_def: tribe.bash_points_def,
                bash_points_off: tribe.bash_points_off,
                bash_points_total: tribe.bash_points_total,
                members: tribe.members,
                name: tribe.name,
                tag: tribe.tag,
                points: tribe.points,
                points_per_member: tribe.points_per_member,
                points_per_villages: tribe.points_per_villages,
                rank: tribe.rank,
                victory_points: tribe.victory_points,
                villages: tribe.villages,
                level: tribePowerToLevel(worldId, tribe.power)
            });
        }

        return data.total;
    };

    const processTribes = async function () {
        let offset = 0;

        const total = await loadTribes(offset);
        offset += RANKING_QUERY_COUNT;

        if (total <= RANKING_QUERY_COUNT) {
            return;
        }

        for (; offset < total; offset += RANKING_QUERY_COUNT * 4) {
            await Promise.all([
                loadTribes(offset),
                loadTribes(offset + RANKING_QUERY_COUNT),
                loadTribes(offset + (RANKING_QUERY_COUNT * 2)),
                loadTribes(offset + (RANKING_QUERY_COUNT * 3))
            ]);
        }
    };

    const loadPlayers = async function (offset) {
        const data = await socket.emit('Ranking/getCharacterRanking', {
            area_type: 'world',
            offset: offset,
            count: RANKING_QUERY_COUNT,
            order_by: 'rank',
            order_dir: 0,
            query: ''
        });

        for (const player of data.ranking) {
            players.set(player.character_id, {
                bash_points_def: player.bash_points_def,
                bash_points_off: player.bash_points_off,
                bash_points_total: player.bash_points_total,
                name: player.name,
                points: player.points,
                points_per_villages: player.points_per_villages,
                rank: player.rank,
                tribe_id: player.tribe_id,
                victory_points: player.victory_points,
                villages: player.villages
            });
        }

        return data.total;
    };

    const processPlayers = async function () {
        let offset = 0;

        const total = await loadPlayers(offset);
        offset += RANKING_QUERY_COUNT;

        if (total <= RANKING_QUERY_COUNT) {
            return;
        }

        for (; offset < total; offset += RANKING_QUERY_COUNT * 4) {
            await Promise.all([
                loadPlayers(offset),
                loadPlayers(offset + RANKING_QUERY_COUNT),
                loadPlayers(offset + (RANKING_QUERY_COUNT * 2)),
                loadPlayers(offset + (RANKING_QUERY_COUNT * 3))
            ]);
        }
    };

    const processVillagesByPlayer = function () {
        for (const character_id of players.keys()) {
            villagesByPlayer.set(character_id, []);
        }

        for (const [id, village] of villages.entries()) {
            const {character_id} = village;

            if (character_id) {
                villagesByPlayer.get(character_id).push(id);
            }
        }
    };

    const processPlayersByTribe = function () {
        for (const tribe_id of tribes.keys()) {
            playersByTribe.set(tribe_id, []);
        }

        for (const [character_id, player] of players.entries()) {
            const {tribe_id} = player;

            if (tribe_id) {
                playersByTribe.get(tribe_id).push(character_id);
            }
        }
    };

    const boundaries = await getBoundaries();
    const missingBlocks = filterBlocks(boundaries);

    for (const [x, y] of missingBlocks) {
        await loadContinent(x, y);
    }

    await processTribes();
    await processPlayers();

    processVillagesByPlayer();
    processPlayersByTribe();

    return {
        villages: Array.from(villages),
        players: Array.from(players),
        tribes: Array.from(tribes),
        provinces: Array.from(provinces),
        villagesByPlayer: Array.from(villagesByPlayer),
        playersByTribe: Array.from(playersByTribe),
        playersAchievement: Array.from(playersAchievement)
    };
}

async function socketScrapeAchivements (socket) {
    const achievementsMap = {
        players: {
            router: 'Achievement/getCharacterAchievements',
            key: 'character_id'
        },
        tribes: {
            router: 'Achievement/getTribeAchievements',
            key: 'tribe_id'
        }
    };

    const playerIds = new Set();
    const tribeIds = new Set();
    const achievementsData = {
        players: new Map(),
        tribes: new Map()
    };

    const loadTribes = async function (offset) {
        // debug('world:%s load tribes ranking %i/?', worldId, offset);

        const data = await socket.emit('Ranking/getTribeRanking', {
            area_type: 'world',
            offset: offset,
            count: RANKING_QUERY_COUNT,
            order_by: 'rank',
            order_dir: 0,
            query: ''
        });

        for (const tribe of data.ranking) {
            tribeIds.add(tribe.tribe_id);
        }

        return data.total;
    };

    const processTribes = async function () {
        let offset = 0;

        const total = await loadTribes(offset);
        offset += RANKING_QUERY_COUNT;

        if (total <= RANKING_QUERY_COUNT) {
            return;
        }

        for (; offset < total; offset += RANKING_QUERY_COUNT * 4) {
            await Promise.all([
                loadTribes(offset),
                loadTribes(offset + RANKING_QUERY_COUNT),
                loadTribes(offset + (RANKING_QUERY_COUNT * 2)),
                loadTribes(offset + (RANKING_QUERY_COUNT * 3))
            ]);
        }
    };

    const loadPlayers = async function (offset) {
        // debug('world:%s load players ranking %i/?', worldId, offset);

        const data = await socket.emit('Ranking/getCharacterRanking', {
            area_type: 'world',
            offset: offset,
            count: RANKING_QUERY_COUNT,
            order_by: 'rank',
            order_dir: 0,
            query: ''
        });

        for (const player of data.ranking) {
            playerIds.add(player.character_id);
        }

        return data.total;
    };

    const processPlayers = async function () {
        let offset = 0;

        const total = await loadPlayers(offset);
        offset += RANKING_QUERY_COUNT;

        if (total <= RANKING_QUERY_COUNT) {
            return;
        }

        for (; offset < total; offset += RANKING_QUERY_COUNT * 4) {
            await Promise.all([
                loadPlayers(offset),
                loadPlayers(offset + RANKING_QUERY_COUNT),
                loadPlayers(offset + (RANKING_QUERY_COUNT * 2)),
                loadPlayers(offset + (RANKING_QUERY_COUNT * 3))
            ]);
        }
    };

    const loadAchievements = async function (type, id) {
        if (!id) {
            return;
        }

        const {router, key} = achievementsMap[type];
        const {achievements} = await socket.emit(router, {[key]: id});

        achievementsData[type].set(id, achievements.filter(achievement => achievement.level));
    };

    const loadTribesAchievements = async function () {
        const tribeIdsArray = Array.from(tribeIds.values());

        for (let i = 0, l = tribeIdsArray.length; i < l; i += 4) {
            // debug('world:%s load tribe achievements %i/%i', worldId, i, l);

            await Promise.all([
                loadAchievements('tribes', tribeIdsArray[i]),
                loadAchievements('tribes', tribeIdsArray[i + 1]),
                loadAchievements('tribes', tribeIdsArray[i + 2]),
                loadAchievements('tribes', tribeIdsArray[i + 3])
            ]);
        }
    };

    const loadPlayersAchievements = async function () {
        const playerIdsArray = Array.from(playerIds.values());

        for (let i = 0, l = playerIdsArray.length; i < l; i += 4) {
            // debug('world:%s load player achievements %i/%i', worldId, i, l);

            await Promise.all([
                loadAchievements('players', playerIdsArray[i]),
                loadAchievements('players', playerIdsArray[i + 1]),
                loadAchievements('players', playerIdsArray[i + 2]),
                loadAchievements('players', playerIdsArray[i + 3])
            ]);
        }
    };

    await processTribes();
    await processPlayers();
    await loadTribesAchievements();
    await loadPlayersAchievements();

    return {
        players: Array.from(achievementsData.players),
        tribes: Array.from(achievementsData.tribes)
    };
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
            dataQueue.clear();
            break;
        }
        case syncCommands.ACHIEVEMENTS_RESET_QUEUE: {
            achievementsQueue.clear();
            break;
        }
    }
}

async function initSyncQueue () {
    debug.queue('initializing sync queue');

    const dataQueue = await db.any(sql('get-sync-queue-type'), {type: syncTypes.DATA});
    const achievementsQueue = await db.any(sql('get-sync-queue-type'), {type: syncTypes.ACHIEVEMENTS});

    await db.none(sql('reset-queue-items'));

    await addSyncQueue(syncTypes.DATA, dataQueue);
    await addSyncQueue(syncTypes.ACHIEVEMENTS, achievementsQueue);
}

async function addSyncQueue (type, newItems) {
    if (!Array.isArray(newItems)) {
        throw new TypeError('Argument newItems must be an Array');
    }

    const {queue} = syncTypeMapping[type];

    for (const item of newItems) {
        const {id} = await db.one(sql('add-sync-queue'), {
            type,
            market_id: item.market_id,
            world_number: item.world_number
        });

        queue.push({
            id,
            handler: async function () {
                await syncWorld(type, item.market_id, item.world_number);
            }
        });
    }
}

async function syncWorld (type, marketId, worldNumber) {
    const syncTypeValues = syncTypeMapping[type];
    const worldId = marketId + worldNumber;
    const urlId = marketId === 'zz' ? 'beta' : marketId;
    let scraper;

    const promise = new Promise(async function (resolve, reject) {
        if (syncTypeValues.activeWorlds.has(worldId)) {
            return reject(syncStatus.IN_PROGRESS);
        }

        syncTypeValues.activeWorlds.add(worldId);

        const world = await getOpenWorld(worldId);
        const marketAccounts = await db.any(sql('get-market-accounts'), {marketId});

        if (!world.sync_enabled) {
            return reject(syncStatus.NOT_ENABLED);
        }

        if (!marketAccounts.length) {
            return reject(syncStatus.NO_ACCOUNTS);
        }

        debug.sync('world:%s start %s sync', worldId, type);

        scraper = await createScraper(marketId, worldNumber);
        const account = await scraper.auth();

        if (!account) {
            return reject(syncStatus.ALL_ACCOUNTS_FAILED);
        }

        const character = account.characters.find(({world_id}) => world_id === worldId);

        if (!character) {
            // await createCharacter(marketId, worldNumber);
        } else if (!character.allow_login) {
            return reject(syncStatus.WORLD_CLOSED);
        } else {
            const success = await scraper.selectCharacter(character.character_id);

            if (!success) {
                return reject(syncStatus.FAILED_TO_SELECT_CHARACTER);
            }
        }

        switch (type) {
            case syncTypes.DATA: {
                await fetchWorldMapStructure(scraper, worldId, urlId);

                debug.sync('world:%s fetching data', worldId);

                const data = await socketScrapeData(scraper, worldId);
                await commitDataDatabase(data, worldId);
                await commitDataFilesystem(worldId);

                if (saveRawData) {
                    await commitRawDataFilesystem(data, worldId);
                }
                break;
            }
            case syncTypes.ACHIEVEMENTS: {
                debug.sync('world:%s fetching achievements', worldId);

                const achievements = await socketScrapeAchivements(scraper);
                await commitAchievementsDatabase(achievements, worldId);

                if (saveRawData) {
                    await commitRawAchievementsFilesystem(achievements, worldId);
                }
                break;
            }
        }

        resolve(syncStatus.SUCCESS);
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
            case syncStatus.FAILED_TO_SELECT_CHARACTER: {
                debug.sync('world:%s failed to select character', worldId);
                break;
            }
            case syncStatus.SUCCESS: {
                debug.sync('world:%s data %s finished', worldId, type);
                break;
            }
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

        // TODO: allow to create scrapers with identifiers other than marketId + worldNumber.
        const scraper = await createScraper(marketId, marketId);
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
    if (fs.existsSync(path.join('.', 'data', worldId, 'struct'))) {
        return;
    }

    ///bin/mapv2-rc1_934bc4ad3c.bin

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

async function commitWorldConfig (worldConfig, worldId) {
    const world = await db.one(sql('get-world'), {worldId});

    if (world.config) {
        return;
    }

    debug.db('world:%s commiting world config', worldId);

    const filteredConfig = {};
    const selectedConfig = [
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

    for (const key of selectedConfig) {
        filteredConfig[key] = worldConfig[key];
    }

    await db.none(sql('update-world-config'), {
        worldId,
        worldConfig: filteredConfig
    });
}

async function commitMarketTimeOffset (timeOffset, marketId) {
    const market = await db.one(sql('get-market'), {marketId});

    if (market.time_offset !== null) {
        return;
    }

    debug.sync('market:%s commit market time offset', marketId);

    await db.none(sql('update-market-time-offset'), {
        marketId,
        timeOffset
    });
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

function createSyncQueue (concurrent) {
    const queue = async.queue(async function (task) {
        debug.queue('task %s start', task.id);

        await db.none(sql('set-queue-item-active'), {id: task.id, active: true});
        await task.handler();
        await db.none(sql('remove-sync-queue'), {id: task.id});

        debug.queue('task %s finish', task.id);
    }, concurrent);

    queue.error(async function (err, task) {
        await db.none(sql('remove-sync-queue'), {id: task.id});
        debug.queue('task %s error: %s', task.id, err.message);
        queue.push(task);
    });

    return queue;
}

function randomInteger (min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Scales down the given rect into a grid and returns its coordinates.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} w
 * @param {number} h
 * @param {number} gridSize
 */
function scaledGridCoordinates (x0, y0, w, h, gridSize) {
    const minX = Math.floor(x0 / gridSize);
    const minY = Math.floor(y0 / gridSize);
    const maxX = Math.ceil((x0 + w) / gridSize);
    const maxY = Math.ceil((y0 + h) / gridSize);
    const gridCoordinates = [];

    if (w === 1 && h === 1) {
        return [[minX, minY]];
    }

    for (let x = minX; x < maxX; x++) {
        for (let y = minY; y < maxY; y++) {
            gridCoordinates.push([x, y]);
        }
    }

    return gridCoordinates;
}

function getExpForLevelStep (worldId, level) {
    const gameData = worldsGameData.get(worldId);
    const exponent = gameData['GameData/baseData']['exp_to_level_exponent'];
    const factor = gameData['GameData/baseData']['exp_to_level_factor'];
    return Math.ceil(Math.pow(level, exponent) * factor);
}

function tribePowerToLevel (worldId, power) {
    let powerLeft = power;
    let powerNeeded;
    let level = 1;

    while (powerLeft > 0) {
        powerNeeded = getExpForLevelStep(worldId, level);

        if (powerNeeded > powerLeft) {
            break;
        }

        ++level;

        powerLeft -= powerNeeded;
    }

    return level;
}

module.exports = {
    init,
    trigger
};
