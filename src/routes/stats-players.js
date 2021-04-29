const utils = require('../utils.js');
const timeUtils = require('../time-utils.js');
const conquestTypes = require('../types/conquest.js');
const historyOrderTypes = require('../types/history-order.js');
const createError = require('http-errors');
const {db, sql} = require('../db.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const {calcHistoryChanges} = require('../history-utils.js');
const {processPlayerConquestTypes} = require('../conquest-utils.js');

const conquestCategories = ['gain', 'loss', 'all', 'self'];
const playerFieldsOrder = [
    ['points', historyOrderTypes.ASC],
    ['villages', historyOrderTypes.ASC],
    ['rank', historyOrderTypes.DESC],
    ['victory_points', historyOrderTypes.ASC],
    ['bash_points_off', historyOrderTypes.ASC],
    ['bash_points_def', historyOrderTypes.ASC],
    ['bash_points_total', historyOrderTypes.ASC]
];

const playerShortFieldsOrder = [
    ['points', historyOrderTypes.ASC],
    ['villages', historyOrderTypes.ASC],
    ['rank', historyOrderTypes.DESC],
    ['victory_points', historyOrderTypes.ASC]
];

const conquestsTypeMap = {
    all: {
        sqlConquests: sql('get-player-conquests'),
        sqlCount: sql('get-player-conquests-count')
    },
    gain: {
        sqlConquests: sql('get-player-conquests-gain'),
        sqlCount: sql('get-player-conquests-gain-count')
    },
    loss: {
        sqlConquests: sql('get-player-conquests-loss'),
        sqlCount: sql('get-player-conquests-loss-count')
    },
    self: {
        sqlConquests: sql('get-player-conquests-self'),
        sqlCount: sql('get-player-conquests-self-count')
    }
};

const {
    paramWorld,
    paramWorldParse,
    paramPlayerParse,
    getTribe,
    getPlayerVillages,
    createPagination,
    createNavigation,
    mergeBackendLocals
} = require('../router-helpers.js');

const playerProfileRouter = async function (request, reply, next) {
    if (!paramWorld(request)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        playerId,
        player
    } = await paramPlayerParse(request, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const conquestLimit = config('ui', 'profile_last_conquest_count');
    const conquestsRaw = await db.any(sql('get-player-conquests'), {worldId, playerId, offset: 0, limit: conquestLimit});
    const conquests = processPlayerConquestTypes(conquestsRaw, playerId);

    const conquestCount = (await db.one(sql('get-player-conquests-count'), {worldId, playerId})).count;
    const conquestGainCount = (await db.one(sql('get-player-conquests-gain-count'), {worldId, playerId})).count;
    const conquestLossCount = (await db.one(sql('get-player-conquests-loss-count'), {worldId, playerId})).count;
    const conquestSelfCount = (await db.one(sql('get-player-conquests-self-count'), {worldId, playerId})).count;

    const achievementTypes = Object.fromEntries(await db.map(sql('achievement-types'), {}, (achievement) => [achievement.name, achievement]));
    const achievements = await db.any(sql('get-player-achievements'), {worldId, id: playerId});
    const achievementsLatest = achievements.slice(0, 5);

    const achievementPoints = achievements.reduce(function (sum, {type, level}) {
        const {milestone, points} = achievementTypes[type];

        if (!points) {
            return sum;
        }

        return milestone
            ? sum + points[level - 1]
            : sum + points.slice(0, level).reduce((sum, next) => sum + next, 0);
    }, 0);

    const historyLimit = config('ui', 'profile_last_history_count');
    const historyFullRaw = await db.any(sql('get-player-history'), {worldId, playerId, limit: 30});
    const historyShortRaw = historyFullRaw.slice(0, historyLimit);
    const history = calcHistoryChanges(historyShortRaw, playerShortFieldsOrder);

    const tribeChangesCount = (await db.one(sql('get-player-tribe-changes-count'), {worldId, id: playerId})).count;
    const tribe = player.tribe_id ? await getTribe(worldId, player.tribe_id) : false;
    const {worlds: otherWorlds} = await db.one(sql('get-player-other-worlds'), {marketId, id: playerId});

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        player,
        historyFullRaw,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    reply.view('stats.ejs', {
        page: 'stats/player',
        title: i18n('stats_player', 'page_titles', reply.locals.lang, [player.name, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        player,
        tribe,
        conquests,
        conquestCount,
        conquestGainCount,
        conquestLossCount,
        conquestSelfCount,
        conquestTypes,
        achievementPoints,
        achievementsLatest,
        achievementTypes,
        history,
        tribeChangesCount,
        otherWorlds,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${worldNumber}/players/${player.id}`, replaces: [player.name]}
        ])
    });
};

const playerVillagesRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        playerId,
        player
    } = await paramPlayerParse(request, worldId);

    const world = await db.one(sql('get-world'), {worldId});
    const villages = await getPlayerVillages(worldId, playerId);

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    reply.view('stats.ejs', {
        page: 'stats/player-villages',
        title: i18n('stats_player_villages', 'page_titles', reply.locals.lang, [player.name, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        marketId,
        worldNumber,
        world,
        player,
        villages,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${worldNumber}/players/${player.id}`, replaces: [player.name]},
            {label: i18n('villages', 'navigation', reply.locals.lang)}
        ])
    });
};

const playerConquestsRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        playerId,
        player
    } = await paramPlayerParse(request, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const page = request.params.page && !isNaN(request.params.page) ? Math.max(1, parseInt(request.params.page, 10)) : 1;
    const limit = config('ui', 'ranking_page_items_per_page');
    const offset = limit * (page - 1);

    const category = request.params.category ?? 'all';

    if (!conquestCategories.includes(category)) {
        throw createError(404, i18n('router_missing_sub_category', 'errors', reply.locals.lang));
    }

    const conquestsRaw = await db.any(conquestsTypeMap[category].sqlConquests, {worldId, playerId, offset, limit});
    const conquests = processPlayerConquestTypes(conquestsRaw, playerId);

    const total = (await db.one(conquestsTypeMap[category].sqlCount, {worldId, playerId})).count;
    const navigationTitle = i18n('sub_title_' + category, 'player_profile_conquests', reply.locals.lang);

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    reply.view('stats.ejs', {
        page: 'stats/player-conquests',
        title: i18n('stats_player_conquests', 'page_titles', reply.locals.lang, [player.name, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        player,
        conquests,
        category,
        navigationTitle,
        pagination: createPagination(page, total, limit, request.url),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${worldNumber}/players/${player.id}`, replaces: [player.name]},
            {label: navigationTitle}
        ])
    });
};

const playerTribeChangesRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        playerId,
        player
    } = await paramPlayerParse(request, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const tribeChanges = await db.any(sql('get-player-tribe-changes'), {worldId, id: playerId});
    const tribeTags = {};

    for (const change of tribeChanges) {
        if (change.old_tribe && !utils.hasOwn(tribeTags, change.old_tribe)) {
            tribeTags[change.old_tribe] = (await db.one(sql('get-tribe'), {worldId, tribeId: change.old_tribe})).tag;
        }

        if (change.new_tribe && !utils.hasOwn(tribeTags, change.new_tribe)) {
            tribeTags[change.new_tribe] = (await db.one(sql('get-tribe'), {worldId, tribeId: change.new_tribe})).tag;
        }
    }

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    reply.view('stats.ejs', {
        page: 'stats/player-tribe-changes',
        title: i18n('stats_player_tribe_changes', 'page_titles', reply.locals.lang, [player.name, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        player,
        tribeChanges,
        tribeTags,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${worldNumber}/players/${player.id}`, replaces: [player.name]},
            {label: i18n('tribe_changes', 'navigation', reply.locals.lang)}
        ])
    });
};

const playerAchievementsRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        playerId,
        player
    } = await paramPlayerParse(request, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const selectedCategory = request.params.category;
    const subCategory = request.params.subCategory;

    const achievementCategories = ['battle', 'points', 'tribe', 'repeatable', 'special', 'friends', 'milestone', 'ruler'];
    const achievementCategoriesUnique = ['battle', 'points', 'tribe', 'special', 'friends', 'milestone', 'ruler'];

    if (selectedCategory && !achievementCategories.includes(selectedCategory)) {
        throw createError(404, i18n('router_missing_category', 'errors', reply.locals.lang));
    }

    if (selectedCategory === 'repeatable') {
        if (!(subCategory === 'detailed' || !subCategory)) {
            throw createError(404, i18n('router_missing_sub_page', 'errors', reply.locals.lang));
        }
    } else if (subCategory) {
        throw createError(404, i18n('router_missing_sub_page', 'errors', reply.locals.lang));
    }

    const achievementTypes = Object.fromEntries(await db.map(sql('achievement-types'), {}, (achievement) => [achievement.name, achievement]));
    const achievements = await db.any(sql('get-player-achievements'), {worldId, id: playerId});
    const achievementByCategory = {};
    const achievementsWithPoints = [];

    for (const category of achievementCategories) {
        achievementByCategory[category] = [];
    }

    for (const achievement of achievements) {
        if (achievement.category !== 'repeatable') {
            const typeData = achievementTypes[achievement.type];

            achievement.points = typeData.milestone
                ? typeData.points[achievement.level - 1]
                : typeData.points.slice(0, achievement.level).reduce((sum, next) => sum + next, 0);
        }

        achievementsWithPoints.push(achievement);
        achievementByCategory[achievement.category].push(achievement);
    }

    const achievementsNonRepeatable = achievementsWithPoints.filter(function (achievement) {
        return achievement.category !== 'repeatable';
    });

    const achievementsRepeatable = achievementsWithPoints.filter(function (achievement) {
        return achievement.category === 'repeatable';
    });

    let categoryTemplate;
    let navigationTitle;
    const overviewData = [];
    const achievementsRepeatableCount = {};
    const achievementsRepeatableLastEarned = {};
    const achievementsRepeatableDetailed = {};

    if (!selectedCategory) {
        categoryTemplate = 'overview';
        navigationTitle = i18n(selectedCategory, 'achievement_categories', reply.locals.lang) + ' ' + i18n('achievements', 'player_profile_achievements', reply.locals.lang);
        
        const categoriesMaxPoints = {};

        for (const category of achievementCategoriesUnique) {
            categoriesMaxPoints[category] = 0;
        }

        for (const achievement of Object.values(achievementTypes)) {
            if (!achievement.repeatable) {
                categoriesMaxPoints[achievement.category] += achievement.milestone
                    ? achievement.points[achievement.points.length - 1]
                    : achievement.points.reduce((sum, next) => sum + next, 0);
            }
        }

        const achievementsMaxPoints = Object.values(categoriesMaxPoints).reduce((sum, next) => sum + next, 0);

        overviewData.push(...achievementCategoriesUnique.map(function (category) {
            const max = categoriesMaxPoints[category];
            const current = achievementByCategory[category].reduce((sum, next) => sum + next.points, 0);
            const percent = Math.floor(current / max * 100);

            return [category, {
                max,
                current,
                percent
            }];
        }));

        const overallCurrent = overviewData.reduce((sum, [, next]) => sum + next.current, 0);
        const overallMax = achievementsMaxPoints;
        const overallPercent = Math.floor(overallCurrent / overallMax * 100);

        overviewData.unshift(['overall', {
            max: overallMax,
            current: overallCurrent,
            percent: overallPercent
        }]);
    } else if (selectedCategory === 'repeatable') {
        categoryTemplate = 'repeatable';
        navigationTitle = i18n(selectedCategory, 'achievement_categories', reply.locals.lang) + ' Achievements';

        for (const {type, time_last_level} of achievementsRepeatable) {
            if (!achievementsRepeatableLastEarned[type]) {
                achievementsRepeatableLastEarned[type] = timeUtils.formatDate(time_last_level, market.time_offset, 'day-only');
            }

            if (subCategory === 'detailed') {
                achievementsRepeatableDetailed[type] = achievementsRepeatableDetailed[type] || [];
                achievementsRepeatableDetailed[type].push(timeUtils.formatDate(time_last_level, market.time_offset, 'day-only'));
            }

            achievementsRepeatableCount[type] = achievementsRepeatableCount[type] ?? 0;
            achievementsRepeatableCount[type]++;
        }
    } else {
        categoryTemplate = 'generic';
        navigationTitle = i18n(selectedCategory, 'achievement_categories', reply.locals.lang) + ' Achievements';
    }

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        player
    });

    reply.view('stats.ejs', {
        page: 'stats/player-achievements',
        title: i18n('stats_player_achievements', 'page_titles', reply.locals.lang, [player.name, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        player,
        selectedCategory,
        subCategory,
        categoryTemplate,
        overviewData,
        achievements,
        achievementByCategory,
        achievementsWithPoints,
        achievementsNonRepeatable,
        achievementsRepeatable,
        achievementsRepeatableLastEarned,
        achievementsRepeatableCount,
        achievementsRepeatableDetailed,
        achievementTypes,
        navigationTitle,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${worldNumber}/players/${player.id}`, replaces: [player.name]},
            {label: i18n('achievements', 'navigation', reply.locals.lang)}
        ])
    });
};

const playerHistoryRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        playerId,
        player
    } = await paramPlayerParse(request, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const historyLimit = config('sync', 'maximum_history_days');
    const historyRaw = await db.any(sql('get-player-history'), {worldId, playerId, limit: historyLimit});
    const history = calcHistoryChanges(historyRaw, playerFieldsOrder);

    mergeBackendLocals(reply, {
        marketId,
        worldNumber
    });

    reply.view('stats.ejs', {
        page: 'stats/player-history',
        title: i18n('stats_player_history', 'page_titles', reply.locals.lang, [player.name, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        player,
        history,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${worldNumber}/players/${playerId}`, replaces: [player.name]},
            {label: i18n('history', 'navigation', reply.locals.lang)}
        ])
    });
};

module.exports = function (fastify, opts, done) {
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId', playerProfileRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/villages', playerVillagesRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/conquests', playerConquestsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/page/:page', playerConquestsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/:category', playerConquestsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/:category/page/:page', playerConquestsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/tribe-changes', playerTribeChangesRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/achievements', playerAchievementsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/achievements/:category', playerAchievementsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/achievements/:category/:subCategory', playerAchievementsRouter);
    fastify.get('/stats/:marketId/:worldNumber/players/:playerId/history', playerHistoryRouter);
    done();
};
