const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const {db} = require('../db.js');
const sql = require('../sql.js');
const utils = require('../utils.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const conquestTypes = require('../conquest-types.json');

const {
    paramWorld,
    paramWorldParse,
    paramPlayerParse,
    getTribe,
    getPlayerVillages,
    createPagination,
    createNavigation,
    mergeBackendLocals,
    asyncRouter
} = require('../router-helpers.js');

const conquestCategories = ['gain', 'loss', 'all', 'self'];

const playerProfileRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId);


    const world = await db.one(sql.getWorld, {worldId});

    const conquestCount = (await db.one(sql.getPlayerConquestsCount, {worldId, playerId})).count;
    const conquestGainCount = (await db.one(sql.getPlayerConquestsGainCount, {worldId, playerId})).count;
    const conquestLossCount = (await db.one(sql.getPlayerConquestsLossCount, {worldId, playerId})).count;
    const conquestSelfCount = (await db.one(sql.getPlayerConquestsSelfCount, {worldId, playerId})).count;

    const achievementTypes = Object.fromEntries(await db.map(sql.achievementTypes, {}, (achievement) => [achievement.name, achievement]));
    const achievements = await db.any(sql.getPlayerAchievements, {worldId, id: playerId});
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

    const tribeChangesCount = (await db.one(sql.getPlayerTribeChangesCount, {worldId, id: playerId})).count;
    const tribe = player.tribe_id ? await getTribe(worldId, player.tribe_id) : false;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    res.render('stats', {
        page: 'stats/player',
        title: i18n('stats_player', 'page_titles', res.locals.lang, [player.name, marketId.toUpperCase(), world.name, config.general.site_name]),
        marketId,
        worldNumber,
        world,
        player,
        tribe,
        conquestCount,
        conquestGainCount,
        conquestLossCount,
        conquestSelfCount,
        conquestTypes,
        achievementPoints,
        achievementsLatest,
        achievementTypes,
        tribeChangesCount,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/players/${player.id}`, replaces: [player.name]}
        ])
    });
});

const playerVillagesRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});
    const villages = await getPlayerVillages(worldId, playerId);

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    res.render('stats', {
        page: 'stats/player-villages',
        title: i18n('stats_player_villages', 'page_titles', res.locals.lang, [player.name, marketId.toUpperCase(), world.name, config.general.site_name]),
        marketId,
        worldNumber,
        world,
        player,
        villages,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/players/${player.id}`, replaces: [player.name]},
            {label: i18n('villages', 'navigation', res.locals.lang)}
        ])
    });
});

const playerConquestsRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1;
    const limit = config.ui.ranking_page_items_per_page;
    const offset = limit * (page - 1);

    const conquestsTypeMap = {
        all: {
            sqlConquests: sql.getPlayerConquests,
            sqlCount: sql.getPlayerConquestsCount,
            navigationTitle: i18n('sub_title_all', 'player_profile_conquests', res.locals.lang)
        },
        gain: {
            sqlConquests: sql.getPlayerConquestsGain,
            sqlCount: sql.getPlayerConquestsGainCount,
            navigationTitle: i18n('sub_title_gain', 'player_profile_conquests', res.locals.lang)
        },
        loss: {
            sqlConquests: sql.getPlayerConquestsLoss,
            sqlCount: sql.getPlayerConquestsLossCount,
            navigationTitle: i18n('sub_title_loss', 'player_profile_conquests', res.locals.lang)
        },
        self: {
            sqlConquests: sql.getPlayerConquestsSelf,
            sqlCount: sql.getPlayerConquestsSelfCount,
            navigationTitle: i18n('sub_title_self', 'player_profile_conquests', res.locals.lang)
        }
    };

    const category = req.params.category ?? 'all';

    if (!conquestCategories.includes(category)) {
        throw createError(404, i18n('router_missing_sub_category', 'errors', res.locals.lang));
    }

    const conquests = await db.map(conquestsTypeMap[category].sqlConquests, {worldId, playerId, offset, limit}, function (conquest) {
        if (conquest.new_owner === conquest.old_owner) {
            conquest.type = conquestTypes.SELF;
        } else if (conquest.new_owner === playerId) {
            conquest.type = conquestTypes.GAIN;
        } else if (conquest.old_owner === playerId) {
            conquest.type = conquestTypes.LOSS;
        }

        return conquest;
    });

    const total = (await db.one(conquestsTypeMap[category].sqlCount, {worldId, playerId})).count;
    const navigationTitle = conquestsTypeMap[category].navigationTitle;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    res.render('stats', {
        page: 'stats/player-conquests',
        title: i18n('stats_player_conquests', 'page_titles', res.locals.lang, [player.name, marketId.toUpperCase(), world.name, config.general.site_name]),
        marketId,
        worldNumber,
        world,
        player,
        conquests,
        category,
        navigationTitle,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/players/${player.id}`, replaces: [player.name]},
            {label: navigationTitle}
        ])
    });
});

const playerTribeChangesRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const tribeChanges = await db.any(sql.getPlayerTribeChanges, {worldId, id: playerId});
    const tribeTags = {};

    for (const change of tribeChanges) {
        if (change.old_tribe && !utils.hasOwn(tribeTags, change.old_tribe)) {
            tribeTags[change.old_tribe] = (await db.one(sql.getTribe, {worldId, tribeId: change.old_tribe})).tag;
        }

        if (change.new_tribe && !utils.hasOwn(tribeTags, change.new_tribe)) {
            tribeTags[change.new_tribe] = (await db.one(sql.getTribe, {worldId, tribeId: change.new_tribe})).tag;
        }
    }

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        player,
        mapHighlights: [player],
        mapHighlightsType: 'players'
    });

    res.render('stats', {
        page: 'stats/player-tribe-changes',
        title: i18n('stats_player_tribe_changes', 'page_titles', res.locals.lang, [player.name, marketId.toUpperCase(), world.name, config.general.site_name]),
        marketId,
        worldNumber,
        world,
        player,
        tribeChanges,
        tribeTags,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/players/${player.id}`, replaces: [player.name]},
            {label: i18n('tribe_changes', 'navigation', res.locals.lang)}
        ])
    });
});

const playerAchievementsRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        playerId,
        player
    } = await paramPlayerParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const selectedCategory = req.params.category;
    const subCategory = req.params.subCategory;

    const achievementCategories = ['battle', 'points', 'tribe', 'repeatable', 'special', 'friends', 'milestone', 'ruler'];
    const achievementCategoriesUnique = ['battle', 'points', 'tribe', 'special', 'friends', 'milestone', 'ruler'];

    if (selectedCategory && !achievementCategories.includes(selectedCategory)) {
        throw createError(404, i18n('router_missing_category', 'errors', res.locals.lang));
    }

    if (selectedCategory === 'repeatable') {
        if (!(subCategory === 'detailed' || !subCategory)) {
            throw createError(404, i18n('router_missing_sub_page', 'errors', res.locals.lang));
        }
    } else if (subCategory) {
        throw createError(404, i18n('router_missing_sub_page', 'errors', res.locals.lang));
    }

    const achievementTypes = Object.fromEntries(await db.map(sql.achievementTypes, {}, (achievement) => [achievement.name, achievement]));
    const achievements = await db.any(sql.getPlayerAchievements, {worldId, id: playerId});
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
        navigationTitle = i18n(selectedCategory, 'achievement_categories', res.locals.lang) + ' ' + i18n('achievements', 'player_profile_achievements', res.locals.lang);
        
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
        navigationTitle = i18n(selectedCategory, 'achievement_categories', res.locals.lang) + ' Achievements';

        for (const {type, time_last_level} of achievementsRepeatable) {
            if (!achievementsRepeatableLastEarned[type]) {
                achievementsRepeatableLastEarned[type] = utils.formatDate(time_last_level, world.time_offset, 'day-only');
            }

            if (subCategory === 'detailed') {
                achievementsRepeatableDetailed[type] = achievementsRepeatableDetailed[type] || [];
                achievementsRepeatableDetailed[type].push(utils.formatDate(time_last_level, world.time_offset, 'day-only'));
            }

            achievementsRepeatableCount[type] = achievementsRepeatableCount[type] ?? 0;
            achievementsRepeatableCount[type]++;
        }
    } else {
        categoryTemplate = 'generic';
        navigationTitle = i18n(selectedCategory, 'achievement_categories', res.locals.lang) + ' Achievements';
    }

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        player
    });

    res.render('stats', {
        page: 'stats/player-achievements',
        title: i18n('stats_player_achievements', 'page_titles', res.locals.lang, [player.name, marketId.toUpperCase(), world.name, config.general.site_name]),
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
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('player', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/players/${player.id}`, replaces: [player.name]},
            {label: i18n('achievements', 'navigation', res.locals.lang)}
        ])
    });
});

router.get('/stats/:marketId/:worldNumber/players/:playerId', playerProfileRouter);
router.get('/stats/:marketId/:worldNumber/players/:playerId/villages', playerVillagesRouter);
router.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/:category?', playerConquestsRouter);
router.get('/stats/:marketId/:worldNumber/players/:playerId/conquests/:category?/page/:page', playerConquestsRouter);
router.get('/stats/:marketId/:worldNumber/players/:playerId/tribe-changes', playerTribeChangesRouter);
router.get('/stats/:marketId/:worldNumber/players/:playerId/achievements/:category?/:subCategory?', playerAchievementsRouter);

module.exports = router;
