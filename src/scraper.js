const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const utils = require('./utils.js');
const debug = require('./debug.js');
const {db, sql} = require('./db.js');

const userAgent = 'Mozilla/5.0%20(X11;%20Linux%20x86_64)%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)%20Chrome/89.0.4389.114%20Safari/537.36';
const MAP_CHUNK_SIZE = 25;
const RANKING_QUERY_COUNT = 25;
let LEVEL_EXPONENT;
let LEVEL_FACTOR;

/**
 * @class
 * @param {String} marketId
 * @param {Number=} worldNumber
 *
 * @typedef {Object} MarketAccount Logged-in account object.
 * @typedef {Object} AccountCharacter Account's character object.
 */
function Scraper (marketId, worldNumber) {
    const worldId = marketId + worldNumber;

    const callbacks = new Map();
    const timeouts = new Map();

    const url = utils.marketDomain(marketId, 'wss://%market.tribalwars2.com/socket.io/?platform=desktop&EIO=3&transport=websocket');
    const socket = new WebSocket(url);
    const LOADING_TIMEOUT = 10000;

    let authenticated = false;
    let characterSelected = false;
    let emitId = 1;
    let pingIntervalId;
    let socketReady;
    let onKillHandler = function () {};

    function init () {
        socketReady = new Promise(resolve => socket.on('open', resolve));

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

        socketReady.then(() => {
            emit('System/identify', {
                device: userAgent,
                api_version: '10.*.*',
                platform: 'browser'
            });
        });
    }

    /**
     * @param {String} type
     * @param {Object=} data
     * @param {Function=} callback
     * @return {Promise<object>}
     *
     * TODO: Detect emits that resolve with Internal Error, kill the socket. First: Study response structure.
     */
    function emit (type, data, callback) {
        return new Promise(async (resolve, reject) => {
            await socketReady;
            const id = emitId++;
            const headers = {traveltimes: [['browser_send', Date.now()]]};
            const msg = {type, data, id, headers};

            // debug.socket('world:%s emit #%i %s %o', worldId, id, type, data);

            socket.send('42' + JSON.stringify(['msg', msg]));

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
    }

    /**
     * Completely defuses the scraper.
     */
    function kill () {
        clearTimeout(pingIntervalId);
        socket.close();
        onKillHandler();
    }

    /**
     * @param {Function} handler
     */
    function onKill (handler) {
        if (typeof handler === 'function') {
            onKillHandler = handler;
        } else {
            throw new TypeError('Scraper: onKill handler is not a Function');
        }
    }

    /**
     * Authenticate using one of the available sync accounts.
     * @return {Promise<MarketAccount|Boolean>} The authenticated account or false.
     */
    async function auth () {
        if (authenticated) {
            return authenticated;
        }

        const marketAccounts = await db.any(sql('get-market-accounts'), {marketId});

        if (!marketAccounts.length) {
            debug.auth('market:%s do not have any accounts', marketId);
            return false;
        }

        while (marketAccounts.length) {
            const credentials = marketAccounts.shift();
            const account = await emit('Authentication/login', credentials);

            if (account.token) {
                debug.auth('market:%s account %s successed', marketId, credentials.name);
                authenticated = account;
                return account;
            } else if (account.code) {
                debug.auth('market:%s account %s failed: %s', marketId, credentials.name, account.code);
            }
        }

        return false;
    }

    /**
     * Select an account's character (world). Simulates the emits
     * like it's a user logging in from the browser.
     *
     * @param {Number} characterId
     * @return {Promise<AccountCharacter|Boolean>}
     */
    async function selectCharacter (characterId) {
        if (characterSelected) {
            return characterSelected;
        }

        /** @type {AccountCharacter} */
        const character = await emit('Authentication/selectCharacter', {
            world_id: worldId,
            id: characterId
        });

        if (character.error_code) {
            return false;
        }

        const gameData = await emit('GameDataBatch/getGameData');
        const characterInfo = await emit('Character/getInfo', {});

        LEVEL_EXPONENT = gameData['GameData/baseData']['exp_to_level_exponent'];
        LEVEL_FACTOR = gameData['GameData/baseData']['exp_to_level_factor'];

        let createVillageId;

        if (!characterInfo.villages.length) {
            const createdVillage = await emit('Character/createVillage', {
                name: character.name,
                direction: 'random'
            });

            createVillageId = createdVillage['village_id'];
        }

        await emit('Premium/listItems');
        await emit('GlobalInformation/getInfo');
        await emit('Effect/getEffects');
        await emit('TribeInvitation/getOwnInvitations');
        await emit('WheelEvent/getEvent');
        await emit('Character/getColors');
        await emit('Group/getGroups');
        await emit('Icon/getVillages');

        const worldConfig = gameData['WorldConfig/config'];

        if (worldConfig['tribe_skills']) {
            emit('TribeSkill/getInfo');
        }

        if (worldConfig['resource_deposits']) {
            emit('ResourceDeposit/getInfo');
        }

        emit('System/getTime', {}).then(function (gameTime) {
            commitMarketTimeOffset(gameTime.offset, marketId);
            commitWorldConfig(gameData['WorldConfig/config'], worldId);
            fetchWorldMapStructure(character.map_name, marketId, worldNumber);
        });

        emit('DailyLoginBonus/getInfo', null);
        emit('Quest/getQuestLines');
        emit('Crm/getInterstitials', {device_type: 'desktop'});

        let village;

        if (createVillageId) {
            const villages = await emit('VillageBatch/getVillageData', {village_ids: [createVillageId]});
            village = villages[createVillageId]['Village/village'];
        } else {
            village = characterInfo.villages[0];
        }

        const coords = scaledGridCoordinates(village.x, village.y, 25, 25, MAP_CHUNK_SIZE);

        for (const [x, y] of coords) {
            emit('Map/getVillagesByArea', {
                x: x * MAP_CHUNK_SIZE,
                y: y * MAP_CHUNK_SIZE,
                width: MAP_CHUNK_SIZE,
                height: MAP_CHUNK_SIZE,
                character_id: characterId
            });
        }

        emit('System/startupTime', {startup_time: utils.randomInteger(4000, 7000), platform: 'browser', device: userAgent});
        emit('InvitePlayer/getInfo');
        emit('VillageBatch/getVillageData', {village_ids: characterInfo.villages.map(village => village.id)});
        emit('SecondVillage/getInfo', {});
        emit('Authentication/completeLogin', {});

        characterSelected = character;

        return characterSelected;
    }

    /**
     * Create a character on a specific world.
     * @param worldNumber
     * @return {Promise<AccountCharacter>}
     */
    async function createCharacter (worldNumber) {
        debug.sync('world:%s create character', worldId);
        return await emit('Authentication/createCharacter', {world: marketId + worldNumber});
    }

    /**
     * @return {Promise<{
     *     provinces: Map<String, Number>,
     *     villages: Map<Number, Object>,
     *     players: Map<Number, Object>,
     *     playersByTribe: Map<Number, Number[]>,
     *     tribes: Map<Number, Object>,
     *     villagesByPlayer: Map<Number, Number[]>
     * }>}
     */
    async function data () {
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

        const loadVillageSection = async (x, y) => {
            const section = await emit('Map/getVillagesByArea', {x, y, width: CHUNK_SIZE, height: CHUNK_SIZE});
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

        const loadTribes = async (offset) => {
            const data = await emit('Ranking/getTribeRanking', {
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
                    level: tribePowerToLevel(tribe.power)
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

        const loadPlayers = async (offset) => {
            const data = await emit('Ranking/getCharacterRanking', {
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

                if (villagesByPlayer.has(character_id)) {
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
            villages,
            players,
            tribes,
            provinces,
            villagesByPlayer,
            playersByTribe
        };
    }

    /**
     * @return {Promise<{players: Map<Number, Array>, tribes: Map<Number, Array>}>}
     */
    async function achievements () {
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

        const loadTribes = async (offset) => {
            const data = await emit('Ranking/getTribeRanking', {
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

        const loadPlayers = async (offset) => {
            const data = await emit('Ranking/getCharacterRanking', {
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

        const loadAchievements = async (type, id) => {
            if (!id) {
                return;
            }

            const {router, key} = achievementsMap[type];
            const {achievements} = await emit(router, {[key]: id});

            achievementsData[type].set(id, achievements.filter(achievement => achievement.level));
        };

        const loadTribesAchievements = async function () {
            const tribeIdsArray = Array.from(tribeIds.values());

            for (let i = 0, l = tribeIdsArray.length; i < l; i += 4) {
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

        return achievementsData;
    }

    init();

    this.kill = kill;
    this.onKill = onKill;
    this.auth = auth;
    this.selectCharacter = selectCharacter;
    this.createCharacter = createCharacter;
    this.data = data;
    this.achievements = achievements;
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

async function fetchWorldMapStructure (fileName, marketId, worldNumber) {
    const worldId = marketId + worldNumber;

    if (fs.existsSync(path.join('.', 'data', worldId, 'struct'))) {
        return;
    }

    debug.sync('world:%s fetch map structure', worldId);

    const url = utils.marketDomain(marketId, `https://%market.tribalwars2.com/bin/${fileName}.bin`);
    const buffer = await utils.getBuffer(url);
    const gzipped = zlib.gzipSync(buffer);

    fs.promises.mkdir(path.join('.', 'data', worldId), {recursive: true});
    fs.promises.writeFile(path.join('.', 'data', worldId, 'struct'), gzipped);
}


/**
 * Scales down the given rect into a grid and returns its coordinates.
 *
 * @param {Number} x0
 * @param {Number} y0
 * @param {Number} w
 * @param {Number} h
 * @param {Number} gridSize
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

function getExpForLevelStep (level) {
    return Math.ceil(Math.pow(level, LEVEL_EXPONENT) * LEVEL_FACTOR);
}

function tribePowerToLevel (power) {
    let powerLeft = power;
    let powerNeeded;
    let level = 1;

    while (powerLeft > 0) {
        powerNeeded = getExpForLevelStep(level);

        if (powerNeeded > powerLeft) {
            break;
        }

        ++level;

        powerLeft -= powerNeeded;
    }

    return level;
}

module.exports = Scraper;
