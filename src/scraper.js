// TW2-Tracker
// Copyright (C) 2021 Relaxeaza
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const async = require('async');
const utils = require('./utils.js');
const debug = require('./debug.js');
const {db, sql} = require('./db.js');
const syncStatus = require('./types/sync-status');
const config = require('./config.js');
let selectedAddress = false;

const userAgent = 'Mozilla/5.0%20(X11;%20Linux%20x86_64)%20AppleWebKit/537.36%20(KHTML,%20like%20Gecko)%20Chrome/89.0.4389.114%20Safari/537.36';
const SIMUL_MAP_CHUNK_SIZE = 25;
const MAP_CHUNK_SIZE = 50;
let LEVEL_EXPONENT;
let LEVEL_FACTOR;
/** @enum {Number} */
const boundarieMapDirections = {LEFT: 0, RIGHT: 1, TOP: 2, BOTTOM: 3};
/** @enum {Number} */
const remainingMapDirections = {TOP_LEFT: 0, TOP_RIGHT: 1, BOTTOM_LEFT: 2, BOTTOM_RIGHT: 3};
/**
 * Those continents are used to detect how big a world is.
 * For each direction, each continent is loaded until one return zero villages.
 * Than the previous continent coord is defined as a boundarie limit.
 * @type {Object}
 */
const BOUNDARIE_CONTINENT_REFERENCE = {
    [boundarieMapDirections.LEFT]: [[400, 400], [400, 500], [300, 400], [300, 500], [200, 400], [200, 500], [100, 400], [100, 500], [0, 400], [0, 500]],
    [boundarieMapDirections.RIGHT]: [[500, 400], [500, 500], [600, 400], [600, 500], [700, 400], [700, 500], [800, 400], [800, 500], [900, 400], [900, 500]],
    [boundarieMapDirections.TOP]: [[400, 300], [500, 300], [400, 200], [500, 200], [400, 100], [500, 100], [400, 0], [500, 0]],
    [boundarieMapDirections.BOTTOM]: [[400, 600], [500, 600], [400, 700], [500, 700], [400, 800], [500, 800], [400, 900], [500, 900]]
};
/**
 * All remaing continents that are not present on BOUNDARIE_CONTINENT_REFERENCE.
 * @type {Object}
 */
const REMAINING_CONTINENT_REFERENCE = {
    [remainingMapDirections.TOP_LEFT]: [[0, 0], [100, 0], [200, 0], [300, 0], [0, 100], [100, 100], [200, 100], [300, 100], [0, 200], [100, 200], [200, 200], [300, 200], [0, 300], [100, 300], [200, 300], [300, 300]],
    [remainingMapDirections.TOP_RIGHT]: [[600, 0], [700, 0], [800, 0], [900, 0], [600, 100], [700, 100], [800, 100], [900, 100], [600, 200], [700, 200], [800, 200], [900, 200], [600, 300], [700, 300], [800, 300], [900, 300]],
    [remainingMapDirections.BOTTOM_LEFT]: [[0, 600], [100, 600], [200, 600], [300, 600], [0, 700], [100, 700], [200, 700], [300, 700], [0, 800], [100, 800], [200, 800], [300, 800], [0, 900], [100, 900], [200, 900], [300, 900]],
    [remainingMapDirections.BOTTOM_RIGHT]: [[600, 600], [700, 600], [800, 600], [900, 600], [600, 700], [700, 700], [800, 700], [900, 700], [600, 800], [700, 800], [800, 800], [900, 800], [600, 900], [700, 900], [800, 900], [900, 900]]
};

const emitRankingData = {
    area_type: 'world',
    offset: 0,
    count: 1,
    order_by: 'rank',
    order_dir: 0,
    query: ''
};

/**
 * @class
 * @param {String} marketId
 * @param {Number=} worldNumber
 *
 * @typedef {Object} MarketAccount Logged-in account object.
 * @typedef {Object} AccountCharacter Account's character object.
 */
function Scraper (marketId, worldNumber) {
    const worldId = marketId + (typeof worldNumber === 'undefined' ? '' : worldNumber);

    const callbacks = new Map();
    const timeouts = new Map();

    const url = utils.marketDomain(marketId, 'wss://%market.tribalwars2.com/socket.io/?platform=desktop&EIO=3&transport=websocket');
    const socket = new WebSocket(url); // Remova localAddress
    const LOADING_TIMEOUT = 10000;

    debug.socket('world:%s init socket connection', worldId);

    let authenticatedAccount = false;
    let characterSelected = false;
    let emitId = 1;
    let pingIntervalId;
    let socketReady;
    let onKillHandler = function () {};

    function init () {
        socketReady = new Promise(function (resolve) {
            debug.socket('world:%s socket opened', worldId);
            socket.on('open', resolve);
        });

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

            debug.socket('world:%s emit #%i %s %o', worldId, id, type, data);

            socket.send('42' + JSON.stringify(['msg', msg]));

            callbacks.set(id, function (data, eventId) {
                if (typeof callback === 'function') {
                    callback(data, eventId);
                    clearTimeout(timeouts.get(id));
                }

                debug.socket('world:%s receive #%i %s', worldId, id, type);
                resolve(data);
            });

            if (typeof callback === 'function') {
                const timeoutId = setTimeout(function () {
                    callbacks.delete(id);
                    timeouts.delete(id);
                    debug.socket('world:%s socket emit id #%i %s timed out', worldId, id, type);
                }, LOADING_TIMEOUT);

                timeouts.set(id, timeoutId);
            }
        });
    }

    /**
     * Completely defuses the scraper.
     */
    this.kill = function kill () {
        clearTimeout(pingIntervalId);
        socketReady.then(function () {
            socket.close();
            onKillHandler();
        });
    };

    /**
     * @param {Function} handler
     */
    this.onKill = function onKill (handler) {
        if (typeof handler === 'function') {
            onKillHandler = handler;
        } else {
            throw new TypeError('Scraper: onKill handler is not a Function');
        }
    };

    /**
     * Authenticate using one of the available sync accounts.
     * @return {Promise<MarketAccount|syncStatus>} The authenticated account or syncStatus.
     */
    this.auth = async function auth () {
        if (authenticatedAccount) {
            return authenticatedAccount;
        }

        const marketAccounts = await db.any(sql('get-market-accounts'), {marketId});

        if (!marketAccounts.length) {
            debug.auth('market:%s do not have any accounts', marketId);
            throw syncStatus.NO_ACCOUNTS;
        }

        while (marketAccounts.length) {
            const credentials = marketAccounts.shift();
            const account = await emit('Authentication/login', credentials);

            if (account.token) {
                debug.auth('market:%s account %s successed', marketId, credentials.name);
                authenticatedAccount = account;
                return account;
            } else if (account.code) {
                debug.auth('market:%s account %s failed: %s', marketId, credentials.name, account.code);
            }
        }

        throw syncStatus.ALL_ACCOUNTS_FAILED;
    };

    /**
     * Select an account's character (world). Simulates the emits
     * like it's a user logging in from the browser.
     *
     * @param {Number} characterId
     * @return {Promise<AccountCharacter|Boolean>}
     */
    this.selectCharacter = async function selectCharacter (characterId) {
        if (!worldNumber) {
            throw new Error('Scraper not configured to select characters (missing worldNumber argument)');
        }

        if (characterSelected) {
            return characterSelected;
        }

        /** @type {AccountCharacter} */
        const character = await emit('Authentication/selectCharacter', {
            world_id: worldId,
            id: characterId
        });

        if (character.error_code) {
            throw syncStatus.FAILED_TO_SELECT_CHARACTER;
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

        const coords = scaledGridCoordinates(village.x, village.y, 25, 25, SIMUL_MAP_CHUNK_SIZE);

        for (const [x, y] of coords) {
            emit('Map/getVillagesByArea', {
                x: x * SIMUL_MAP_CHUNK_SIZE,
                y: y * SIMUL_MAP_CHUNK_SIZE,
                width: SIMUL_MAP_CHUNK_SIZE,
                height: SIMUL_MAP_CHUNK_SIZE,
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
    };

    /**
     * Create a character on a specific world.
     * @param {Number} worldNumber
     * @return {Promise<AccountCharacter>}
     */
    this.createCharacter = async function createCharacter (worldNumber) {
        if (typeof worldNumber !== 'number') {
            throw new TypeError('worldNumber argument must be of type Number.');
        }

        const worldId = marketId + worldNumber;
        debug.sync('world:%s create character', worldId);
        return await emit('Authentication/createCharacter', {world: worldId});
    };

    /**
     * Get the character id on a specific world.
     * @param {String} worldId
     * @return {Promise<Number|syncStatus>}
     */
    this.getCharacterId = async function getCharacterId (worldId) {
        if (!authenticatedAccount) {
            return syncStatus.CHARACTER_NOT_SELECTED;
        }

        const character = authenticatedAccount.characters.find(({world_id}) => world_id === worldId);

        if (character) {
            if (character.maintenance) {
                throw syncStatus.WORLD_IN_MAINTENANCE;
            } else if (character.allow_login) {
                return character.character_id;
            } else {
                throw syncStatus.WORLD_CLOSED;
            }
        }

        const availableWorld = authenticatedAccount.worlds.some(({world_id}) => world_id === worldId);

        if (!availableWorld) {
            throw syncStatus.WORLD_CLOSED;
        }

        const created = await this.createCharacter(worldNumber);

        if (created.id) {
            return created.id;
        }

        throw syncStatus.FAILED_TO_SELECT_CHARACTER;
    };

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
    this.data = async function data () {
        function processTribes (rawTribes) {
            const tribes = new Map();
            for (const tribe of rawTribes) {
                tribe.level = tribePowerToLevel(tribe.power);
                tribes.set(tribe.tribe_id, tribe);
            }
            return tribes;
        }

        function processPlayers (rawPlayers) {
            const players = new Map();
            for (const player of rawPlayers) {
                players.set(player.character_id, player);
            }
            return players;
        }

        const {villages, provinces} = await loadContinents();
        const rawTribes = await loadTribesRanking();
        const rawPlayers = await loadPlayersRanking();
        const tribes = processTribes(rawTribes);
        const players = processPlayers(rawPlayers);
        const villagesByPlayer = processVillagesByPlayer(villages, players);
        const playersByTribe = processPlayersByTribe(players, tribes);

        return {
            provinces,
            villages,
            players,
            playersByTribe,
            tribes,
            villagesByPlayer
        };
    };

    /**
     * @return {Promise<{
     *     players: Map<Number, Array>,
     *     tribes: Map<Number, Array>
     * }>}
     */
    this.achievements = async function achievements () {
        async function processTribes (rawTribes) {
            const queue = async.queue(async handler => await handler(), 4);
            const tribesAchievements = new Map();

            for (const {tribe_id} of rawTribes) {
                queue.push(async function () {
                    const {achievements} = await emit('Achievement/getTribeAchievements', {tribe_id});
                    tribesAchievements.set(tribe_id, achievements);
                });
            }

            await queue.drain();
            return tribesAchievements;
        }

        async function processPlayers (rawPlayers) {
            const queue = async.queue(async handler => await handler(), 4);
            const playersAchievements = new Map();

            for (const {character_id} of rawPlayers) {
                queue.push(async function () {
                    const {achievements} = await emit('Achievement/getCharacterAchievements', {character_id});
                    playersAchievements.set(character_id, achievements);
                });
            }

            await queue.drain();
            return playersAchievements;
        }

        const rawPlayers = await loadPlayersRanking();
        const rawTribes = await loadTribesRanking();
        const players = await processPlayers(rawPlayers);
        const tribes = await processTribes(rawTribes);

        return {
            players,
            tribes
        };
    };

    async function loadVillageSection (x, y) {
        return await emit('Map/getVillagesByArea', {x, y, width: MAP_CHUNK_SIZE, height: MAP_CHUNK_SIZE});
    }

    async function loadContinents () {
        const rawVillages = [];

        const boundaries = {
            [boundarieMapDirections.LEFT]: 500,
            [boundarieMapDirections.RIGHT]: 500,
            [boundarieMapDirections.TOP]: 500,
            [boundarieMapDirections.BOTTOM]: 500
        };

        for (const direction of Object.values(boundarieMapDirections)) {
            for (let i = 0; i < BOUNDARIE_CONTINENT_REFERENCE[direction].length; i++) {
                const [x, y] = BOUNDARIE_CONTINENT_REFERENCE[direction][i];
                const continentVillages = await loadContinent(x, y);

                if (continentVillages.length === 0) {
                    break;
                }

                rawVillages.push(...continentVillages);
                boundaries[direction] = (direction === boundarieMapDirections.LEFT || direction === boundarieMapDirections.RIGHT) ? x : y;
            }
        }

        const missingContinents = filterContinentsOutsideBoundaries(boundaries);

        for (const [x, y] of missingContinents) {
            const continentVillages = await loadContinent(x, y);
            rawVillages.push(...continentVillages);
        }

        return processVillages(rawVillages);
    }

    async function loadContinent (x, y) {
        const villages = [];
        const sections = [
            await loadVillageSection(x, y),
            await loadVillageSection(x + MAP_CHUNK_SIZE, y),
            await loadVillageSection(x, y + MAP_CHUNK_SIZE),
            await loadVillageSection(x + MAP_CHUNK_SIZE, y + MAP_CHUNK_SIZE)
        ];

        for (const section of sections) {
            villages.push(...section.villages);
        }

        return villages;
    }

    async function loadTribesRanking () {
        const {total} = await emit('Ranking/getTribeRanking', emitRankingData);
        const {ranking} = await emit('Ranking/getTribeRanking', {...emitRankingData, ...{count: total}});
        return ranking;
    }

    async function loadPlayersRanking () {
        const {total} = await emit('Ranking/getCharacterRanking', emitRankingData);
        const {ranking} = await emit('Ranking/getCharacterRanking', {...emitRankingData, ...{count: total}});
        return ranking;
    }

    function processVillages (rawVillages) {
        const villages = new Map();
        const provinces = new Map();

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

        return {villages, provinces};
    }

    function processVillagesByPlayer (villages, players) {
        const villagesByPlayer = new Map();

        for (const character_id of players.keys()) {
            villagesByPlayer.set(character_id, []);
        }

        for (const [id, village] of villages.entries()) {
            const {character_id} = village;

            if (villagesByPlayer.has(character_id)) {
                villagesByPlayer.get(character_id).push(id);
            }
        }

        return villagesByPlayer;
    }

    function processPlayersByTribe (players, tribes) {
        const playersByTribe = new Map();

        for (const tribe_id of tribes.keys()) {
            playersByTribe.set(tribe_id, []);
        }

        for (const [character_id, player] of players.entries()) {
            const {tribe_id} = player;

            if (tribe_id) {
                playersByTribe.get(tribe_id).push(character_id);
            }
        }

        return playersByTribe;
    }

    init();
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

    await fs.promises.mkdir(path.join('.', 'data', worldId), {recursive: true});
    await fs.promises.writeFile(path.join('.', 'data', worldId, 'struct'), gzipped);
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

// function sleep (ms = 250) {
//     return new Promise(function (resolve) {
//         setTimeout(resolve, ms);
//     });
// }

function filterContinentsOutsideBoundaries (boundaries) {
    return [
        ...REMAINING_CONTINENT_REFERENCE[remainingMapDirections.TOP_LEFT].filter(([x, y]) => x >= boundaries[boundarieMapDirections.LEFT] && y >= boundaries[boundarieMapDirections.TOP]),
        ...REMAINING_CONTINENT_REFERENCE[remainingMapDirections.TOP_RIGHT].filter(([x, y]) => x <= boundaries[boundarieMapDirections.RIGHT] && y >= boundaries[boundarieMapDirections.TOP]),
        ...REMAINING_CONTINENT_REFERENCE[remainingMapDirections.BOTTOM_LEFT].filter(([x, y]) => x >= boundaries[boundarieMapDirections.LEFT] && y <= boundaries[boundarieMapDirections.BOTTOM]),
        ...REMAINING_CONTINENT_REFERENCE[remainingMapDirections.BOTTOM_RIGHT].filter(([x, y]) => x <= boundaries[boundarieMapDirections.RIGHT] && y <= boundaries[boundarieMapDirections.BOTTOM])
    ];
}

function rotateAddress () {
    const availableAddresses = config('sync', 'fail_over_ips');

    if (!Array.isArray(availableAddresses) || !availableAddresses.length) {
        selectedAddress = false;
        return false;
    }

    if (selectedAddress) {
        const currentIndex = availableAddresses.indexOf(selectedAddress);

        if (currentIndex === -1 || availableAddresses.length === currentIndex + 1) {
            selectedAddress = availableAddresses[0];
        } else {
            selectedAddress = availableAddresses[currentIndex + 1];
        }
    }

    return true;
}

module.exports = Scraper;
