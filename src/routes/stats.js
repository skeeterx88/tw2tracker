const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const config = require('../config.js');
const {db} = require('../db.js');
const sql = require('../sql.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    paramMarket,
    groupAchievements,
    createNavigation,
    mergeBackendLocals,
    asyncRouter,
    parseRankingSort
} = require('../router-helpers.js');

const rankingsRouter = require('./stats-rankings.js');
const searchRouter = require('./stats-search.js');
const villagesRouter = require('./stats-villages.js');
const playersRouter = require('./stats-players.js');
const tribesRouter = require('./stats-tribes.js');
const conquestsRouter = require('./stats-conquests.js');

const marketsRouter = asyncRouter(async function (req, res, next) {
    const worlds = await db.any(sql.getWorlds);
    const marketsIds = Array.from(new Set(worlds.map(world => world.market)));
    const worldsByMarket = {};

    for (const world of worlds) {
        worldsByMarket[world.market] = worldsByMarket[world.market] || {closed: [], open: []};

        if (world.open) {
            worldsByMarket[world.market].open.push([world.num, world]);
        } else {
            worldsByMarket[world.market].closed.push([world.num, world]);
        }
    }

    const marketStats = marketsIds.map(function (id) {
        return {
            id,
            players: worlds.reduce((base, next) => next.market === id ? base + next.player_count : base, 0),
            tribes: worlds.reduce((base, next) => next.market === id ? base + next.tribe_count : base, 0),
            villages: worlds.reduce((base, next) => next.market === id ? base + next.village_count : base, 0),
            openWorld: worlds.filter((world) => world.market === id && world.open).length,
            closedWorld: worlds.filter((world) => world.market === id && !world.open).length
        };
    });

    mergeBackendLocals(res, {
        worldsByMarket,
        marketStats
    });

    res.render('stats', {
        page: 'stats/market-list',
        title: i18n('stats_servers', 'page_titles', res.locals.lang, [config.general.site_name]),
        pageType: 'stats',
        marketStats,
        worldsByMarket,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('servers', 'navigation', res.locals.lang)}
        ])
    });
});

const worldsRouter = asyncRouter(async function (req, res, next) {
    if (!paramMarket(req)) {
        return next();
    }

    const marketId = req.params.marketId;
    const syncedWorlds = await db.any(sql.getSyncedWorlds);
    const marketWorlds = syncedWorlds.filter((world) => world.market === marketId);

    if (!marketWorlds.length) {
        throw createError(404, i18n('missing_world', 'errors', res.locals.lang));
    }

    const worlds = {
        open: [],
        closed: []
    };

    for (const world of marketWorlds) {
        if (world.open) {
            worlds.open.push(world);
        } else {
            worlds.closed.push(world);
        }
    }

    const marketStats = {
        players: marketWorlds.reduce((sum, world) => sum + world.player_count, 0),
        tribes: marketWorlds.reduce((sum, world) => sum + world.tribe_count, 0),
        villages: marketWorlds.reduce((sum, world) => sum + world.village_count, 0),
        openWorlds: worlds.open.length,
        closedWorlds: worlds.closed.length
    };

    mergeBackendLocals(res, {
        marketId
    });

    res.render('stats', {
        page: 'stats/world-list',
        title: i18n('stats_worlds', 'page_titles', res.locals.lang, [marketId.toUpperCase(), config.general.site_name]),
        marketId,
        worlds,
        marketStats,
        pageType: 'stats',
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('worlds', 'navigation', res.locals.lang)}
        ])
    });
});

const worldRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const world = await db.one(sql.getWorld, {worldId});

    const {
        playerRankingSortField,
        playerRankingSortOrder,
        tribeRankingSortField,
        tribeRankingSortOrder
    } = parseRankingSort(req, world.config.victory_points);

    const [
        players,
        tribes,
        lastConquests,
        lastDailyPlayerAchievements,
        lastWeeklyPlayerAchievements,
        lastDailyTribeAchievements,
        lastWeeklyTribeAchievements
    ] = await Promise.all([
        db.any(sql.getWorldTopPlayers, {worldId, limit: config.ui.world_page_maximum_ranking_items, playerRankingSortField, playerRankingSortOrder}),
        db.any(sql.getWorldTopTribes, {worldId, limit: config.ui.world_page_maximum_ranking_items, tribeRankingSortField, tribeRankingSortOrder}),
        db.any(sql.getWorldLastConquests, {worldId, limit: config.ui.world_page_maximum_last_conquests}),
        db.any(sql.getWorldLastPlayerRepeatableAchievements, {worldId, period: '%-%-%'}),
        db.any(sql.getWorldLastPlayerRepeatableAchievements, {worldId, period: '%-W%'}),
        db.any(sql.getWorldLastTribeRepeatableAchievements, {worldId, period: '%-%-%'}),
        db.any(sql.getWorldLastTribeRepeatableAchievements, {worldId, period: '%-W%'})
    ]);

    if (!world.config.victory_points) {
        const topTenVillages = tribes.reduce((villages, tribe) => villages + tribe.villages, 0);

        for (const tribe of tribes) {
            tribe.domination = parseFloat((tribe.villages / topTenVillages * 100).toFixed(1));
        }
    }

    const achievements = {
        counts: {
            players: {
                daily: lastDailyPlayerAchievements.length,
                weekly: lastWeeklyPlayerAchievements.length
            },
            tribes: {
                daily: lastDailyTribeAchievements.length,
                weekly: lastWeeklyTribeAchievements.length
            }
        },
        groups: {
            players: {
                daily: groupAchievements(lastDailyPlayerAchievements),
                weekly: groupAchievements(lastWeeklyPlayerAchievements)
            },
            tribes: {
                daily: groupAchievements(lastDailyTribeAchievements),
                weekly: groupAchievements(lastWeeklyTribeAchievements)
            }
        }
    };

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        players,
        tribes,
        mapHighlights: tribes.slice(0, 3),
        mapHighlightsType: 'tribes'
    });

    res.render('stats', {
        page: 'stats/world',
        title: i18n('stats_world', 'page_titles', res.locals.lang, [marketId.toUpperCase(), world.name, config.general.site_name]),
        marketId,
        worldNumber,
        players,
        tribes,
        world,
        lastConquests,
        achievements,
        playerRankingSortField,
        tribeRankingSortField,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: world.open ? i18n('world', 'navigation', res.locals.lang) : i18n('world_closed', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/`, replaces: [world.name]}
        ])
    });
});

router.get('/', marketsRouter);
router.get('/stats', marketsRouter);
router.get('/stats/:marketId', worldsRouter);
router.get('/stats/:marketId/:worldNumber', worldRouter);
router.use(rankingsRouter);
router.use(searchRouter);
router.use(villagesRouter);
router.use(playersRouter);
router.use(tribesRouter);
router.use(conquestsRouter);

module.exports = router;
