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

const createError = require('http-errors');
const utils = require('./utils.js');
const {db, sql} = require('./db.js');
const config = require('./config.js');
const i18n = require('./i18n.js');
const rankingSortTypes = require('./types/ranking-sort.js');
const rankingSortTypesValues = Object.values(rankingSortTypes);

async function getPlayer (worldId, playerId) {
    const player = await db.any(sql('get-player'), {worldId, playerId});

    if (!player.length) {
        throw createError(404, 'This tribe does not exist');
    }

    return player[0];
}

async function getTribe (worldId, tribeId) {
    const tribe = await db.any(sql('get-tribe'), {worldId, tribeId});


    if (!tribe.length) {
        throw createError(404, 'This tribe does not exist');
    }

    return tribe[0];
}

async function getVillage (worldId, villageId) {
    const village = await db.any(sql('get-village'), {worldId, villageId});

    if (!village.length) {
        throw createError(404, 'This village does not exist');
    }

    return village[0];
}

async function getPlayerVillages (worldId, playerId) {
    return await db.any(sql('get-player-villages'), {worldId, playerId});
}

function paramMarket (req) {
    return req.params.marketId.length === 2;
}

function paramWorld (req) {
    return req.params.marketId.length === 2 && !isNaN(req.params.worldNumber);
}

async function paramWorldParse (req) {
    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);
    const worldId = marketId + worldNumber;
    const [worldExists] = await db.any(sql('helpers/schema-exists'), {schema: worldId});

    if (!worldExists) {
        throw createError(404, i18n('missing_world', 'errors', req.session.lang));
    }

    return {
        marketId,
        worldId,
        worldNumber
    };
}

async function paramTribeParse (req, worldId) {
    const tribeId = parseInt(req.params.tribeId, 10);
    const tribe = await getTribe(worldId, tribeId);

    return {
        tribeId,
        tribe
    };
}

async function paramPlayerParse (req, worldId) {
    const playerId = parseInt(req.params.playerId, 10);
    const player = await getPlayer(worldId, playerId);

    return {
        playerId,
        player
    };
}

async function paramVillageParse (req, worldId) {
    const villageId = parseInt(req.params.villageId, 10);
    const village = await getVillage(worldId, villageId);

    return {
        villageId,
        village
    };
}

function createPagination (current, total, limit, path) {
    if (isNaN(current)) {
        throw new Error('Pagination: Current is not a number.');
    }

    if (isNaN(total)) {
        throw new Error('Pagination: Total is not a number.');
    }

    if (isNaN(limit)) {
        throw new Error('Pagination: Limit is not a number.');
    }

    const last = Math.max(1, parseInt(Math.ceil(total / limit), 10));
    const start = Math.max(1, current - 3);
    const end = Math.min(last, current + 3);

    path = path.replace(/\/page\/\d+|\/$/, '');

    return {
        current,
        last,
        start,
        end,
        path,
        showAllPages: last <= 7,
        showGotoLast: end < last,
        showGotoFirst: start > 1,
        showGotoNext: current < last,
        showGotoPrev: current > 1 && last > 1
    };
}

function createNavigation (items) {
    return items.map(function ({label = '', url, replaces = []}) {
        label = label.replace(/%{style}/g, '<span class="keep-color">');
        label = label.replace(/%{style_end}/g, '</span>');
        label = utils.sprintf(label, replaces);
        return url ? `<a href="${url}">${label}</a>` : label;
    }).join(config('ui', 'navigation_separator'));
}

function groupAchievements (achievements) {
    const group = {};

    for (const achievement of achievements) {
        group[achievement.type] = group[achievement.type] || [];
        group[achievement.type].push(achievement);
    }

    return Object.entries(group);
}

function mergeBackendLocals (reply, obj) {
    reply.locals.backendValues = {
        ...reply.locals.backendValues,
        ...obj
    };
}

function parseRankingSort (req, victoryPointSystem) {
    if (req.query.tsort) {
        req.session.tribeRankingSortField = req.query.tsort;
    }

    if (req.query.psort) {
        req.session.playerRankingSortField = req.query.psort;
    }

    if (!rankingSortTypesValues.includes(req.session.tribeRankingSortField)) {
        req.session.tribeRankingSortField = rankingSortTypes.VICTORY_POINTS;
    }

    if (!rankingSortTypesValues.includes(req.session.playerRankingSortField)) {
        req.session.playerRankingSortField = rankingSortTypes.VICTORY_POINTS;
    }

    if (!victoryPointSystem) {
        if (req.session.tribeRankingSortField === rankingSortTypes.VICTORY_POINTS) {
            req.session.tribeRankingSortField = rankingSortTypes.POINTS;
        }

        if (req.session.playerRankingSortField === rankingSortTypes.VICTORY_POINTS) {
            req.session.playerRankingSortField = rankingSortTypes.POINTS;
        }
    }

    return {
        playerRankingSortField: req.session.playerRankingSortField,
        playerRankingSortOrder: req.session.playerRankingSortField === rankingSortTypes.RANK ? 'ASC' : 'DESC',
        tribeRankingSortField: req.session.tribeRankingSortField,
        tribeRankingSortOrder: req.session.tribeRankingSortField === rankingSortTypes.RANK ? 'ASC' : 'DESC'
    };
}

module.exports = {
    getPlayer,
    getPlayerVillages,
    getTribe,
    paramWorld,
    paramMarket,
    paramWorldParse,
    paramTribeParse,
    paramPlayerParse,
    paramVillageParse,
    createPagination,
    groupAchievements,
    createNavigation,
    mergeBackendLocals,
    parseRankingSort
};
