const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const utils = require('../utils');
const config = require('../config.js');
const db = require('../db.js');
const sql = require('../sql.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    paramMarket,
    groupAchievements,
    createNavigation,
    createPageTitle
} = require('../router-helpers.js');

const rankingsRouter = require('./stats-rankings.js');
const searchRouter = require('./stats-search.js');
const villagesRouter = require('./stats-villages.js');
const playersRouter = require('./stats-players.js');
const tribesRouter = require('./stats-tribes.js');
const conquestsRouter = require('./stats-conquests.js');

const marketsRouter = utils.asyncRouter(async function (req, res, next) {
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

    res.render('stats', {
        page: 'market-list',
        title: createPageTitle(i18n('stats_servers', 'page_titles', res.locals.lang), [config.site_name]),
        pageType: 'stats',
        marketStats,
        worldsByMarket,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('servers', 'navigation', res.locals.lang)}
        ]),
        backendValues: {
            worldsByMarket,
            marketStats,
            languages: res.locals.languages,
            selectedLanguage: req.session.lang
        }
    });
});

const worldsRouter = utils.asyncRouter(async function (req, res, next) {
    if (!paramMarket(req)) {
        return next();
    }

    const marketId = req.params.marketId;
    const syncedWorlds = await db.any(sql.getSyncedWorlds);
    const marketWorlds = syncedWorlds.filter((world) => world.market === marketId);

    if (!marketWorlds.length) {
        throw createError(404, i18n('missing_world', 'errors', res.locals.lang));
    }

    const sortedWorlds = marketWorlds.sort((a, b) => a.num - b.num);
    const worlds = [
        [i18n('open_worlds', 'world_list', res.locals.lang), sortedWorlds.filter(world => world.open)],
        [i18n('closed_worlds', 'world_list', res.locals.lang), sortedWorlds.filter(world => !world.open)]
    ];

    res.render('stats', {
        page: 'world-list',
        title: createPageTitle(i18n('stats_worlds', 'page_titles', res.locals.lang), [marketId.toUpperCase(), config.site_name]),
        marketId,
        worlds,
        pageType: 'stats',
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('worlds', 'navigation', res.locals.lang)}
        ]),
        backendValues: {
            marketId
        }
    });
});

const worldRouter = utils.asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const [
        world,
        players,
        tribes,
        lastConquests,
        lastDailyPlayerAchievements,
        lastWeeklyPlayerAchievements,
        lastDailyTribeAchievements,
        lastWeeklyTribeAchievements
    ] = await Promise.all([
        db.one(sql.getWorld, [marketId, worldNumber]),
        db.any(sql.getWorldTopPlayers, {worldId, limit: config.ui.world_page_maximum_ranking_items}),
        db.any(sql.getWorldTopTribes, {worldId, limit: config.ui.world_page_maximum_ranking_items}),
        db.any(sql.getWorldLastConquests, {worldId, limit: config.ui.world_page_maximum_last_conquests}),
        db.any(sql.getWorldLastPlayerRepeatableAchievements, {worldId, period: '%-%-%'}),
        db.any(sql.getWorldLastPlayerRepeatableAchievements, {worldId, period: '%-W%'}),
        db.any(sql.getWorldLastTribeRepeatableAchievements, {worldId, period: '%-%-%'}),
        db.any(sql.getWorldLastTribeRepeatableAchievements, {worldId, period: '%-W%'})
    ]);

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

    res.render('stats', {
        page: 'stats/world',
        title: createPageTitle(i18n('stats_world', 'page_titles', res.locals.lang), [marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        players,
        tribes,
        world,
        lastConquests,
        achievements,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: world.open ? i18n('world', 'navigation', res.locals.lang) : i18n('world_closed', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/`, replaces: [world.name]},
        ]),
        backendValues: {
            marketId,
            worldNumber,
            players,
            tribes,
            mapHighlights: tribes.slice(0, 3),
            mapHighlightsType: 'tribes'
        }
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
