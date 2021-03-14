const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const {db} = require('../db.js');
const sql = require('../sql.js');
const utils = require('../utils.js');
const config = require('../config.js');
const i18n = require('../i18n.js');
const conquestTypes = require('../conquest-types.json');
const memberChangeTypes = require('../member-change-types.json');


const {
    paramWorld,
    paramWorldParse,
    paramTribeParse,
    createPagination,
    createNavigation,
    mergeBackendLocals,
    asyncRouter
} = require('../router-helpers.js');

const conquestCategories = ['gain', 'loss', 'all', 'self'];

const tribeRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const conquestCount = (await db.one(sql.getTribeConquestsCount, {worldId, tribeId})).count;
    const conquestGainCount = (await db.one(sql.getTribeConquestsGainCount, {worldId, tribeId})).count;
    const conquestLossCount = (await db.one(sql.getTribeConquestsLossCount, {worldId, tribeId})).count;
    const conquestSelfCount = (await db.one(sql.getTribeConquestsSelfCount, {worldId, tribeId})).count;

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribeId});
    const achievementsLatest = achievements.slice(0, 5);
    const achievementsRepeatableCount = achievements.reduce((sum, {period}) => period ? sum + 1 : sum, 0);

    const memberChangesCount = (await db.one(sql.getTribeMemberChangesCount, {worldId, id: tribeId})).count;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        tribe,
        mapHighlights: [tribe],
        mapHighlightsType: 'tribes'
    });

    res.render('stats', {
        page: 'stats/tribe',
        title: i18n('stats_tribe', 'page_titles', res.locals.lang, [tribe.tag, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        world,
        tribe,
        conquestCount,
        conquestGainCount,
        conquestLossCount,
        conquestSelfCount,
        conquestTypes,
        achievementsRepeatableCount,
        achievementsLatest,
        memberChangesCount,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('tribe', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/tribes/${tribeId}`, replaces: [tribe.tag]}
        ])
    });
});

const tribeConquestsRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1;
    const limit = config.ui.ranking_page_items_per_page;
    const offset = limit * (page - 1);

    const conquestsTypeMap = {
        all: {
            sqlConquests: sql.getTribeConquests,
            sqlCount: sql.getTribeConquestsCount,
            navigationTitle: i18n('sub_title_all', 'tribe_profile_achievements', res.locals.lang)
        },
        gain: {
            sqlConquests: sql.getTribeConquestsGain,
            sqlCount: sql.getTribeConquestsGainCount,
            navigationTitle: i18n('sub_title_gain', 'tribe_profile_achievements', res.locals.lang)
        },
        loss: {
            sqlConquests: sql.getTribeConquestsLoss,
            sqlCount: sql.getTribeConquestsLossCount,
            navigationTitle: i18n('sub_title_loss', 'tribe_profile_achievements', res.locals.lang)
        },
        self: {
            sqlConquests: sql.getTribeConquestsSelf,
            sqlCount: sql.getTribeConquestsSelfCount,
            navigationTitle: i18n('sub_title_self', 'tribe_profile_achievements', res.locals.lang)
        }
    };

    const category = req.params.category ?? 'all';

    if (!conquestCategories.includes(category)) {
        throw createError(404, i18n('router_missing_sub_page', 'errors', res.locals.lang));
    }

    const conquests = await db.map(conquestsTypeMap[category].sqlConquests, {worldId, tribeId, offset, limit}, function (conquest) {
        if (conquest.new_owner_tribe_id === conquest.old_owner_tribe_id) {
            conquest.type = conquestTypes.SELF;
        } else if (conquest.new_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.GAIN;
        } else if (conquest.old_owner_tribe_id === tribeId) {
            conquest.type = conquestTypes.LOSS;
        }

        return conquest;
    });

    const total = (await db.one(conquestsTypeMap[category].sqlCount, {worldId, tribeId})).count;
    const navigationTitle = conquestsTypeMap[category].navigationTitle;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        tribe,
        mapHighlights: [tribe],
        mapHighlightsType: 'tribes'
    });

    res.render('stats', {
        page: 'stats/tribe-conquests',
        title: i18n('stats_tribe_conquests', 'page_titles', res.locals.lang, [tribe.tag, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        world,
        tribe,
        conquests,
        conquestTypes,
        category,
        navigationTitle,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('tribe', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/tribes/${tribeId}`, replaces: [tribe.tag]},
            {label: navigationTitle}
        ])
    });
});

const tribeMembersRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});
    const members = await db.any(sql.getTribeMembers, {worldId, tribeId});

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        tribe,
        mapHighlights: [tribe],
        mapHighlightsType: 'tribes'
    });

    res.render('stats', {
        page: 'stats/tribe-members',
        title: i18n('stats_tribe_members', 'page_titles', res.locals.lang, [tribe.tag, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        tribe,
        members,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('tribe', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/tribes/${tribeId}`, replaces: [tribe.tag]},
            {label: i18n('members', 'navigation', res.locals.lang)}
        ])
    });
});

const tribeVillagesRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1;
    const limit = config.ui.ranking_page_items_per_page;
    const offset = limit * (page - 1);
    const allVillages = await db.any(sql.getTribeVillages, {worldId, tribeId});
    const villages = allVillages.slice(offset, offset + limit);
    const total = allVillages.length;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        tribe,
        mapHighlights: [tribe],
        mapHighlightsType: 'tribes'
    });

    res.render('stats', {
        page: 'stats/tribe-villages',
        title: i18n('stats_tribe_villages', 'page_titles', res.locals.lang, [tribe.tag, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        tribe,
        villages,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('tribe', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/tribes/${tribeId}`, replaces: [tribe.tag]},
            {label: i18n('villages', 'navigation', res.locals.lang)}
        ])
    });
});

const tribeMembersChangeRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const playersName = {};
    const memberChangesRaw = await db.any(sql.getTribeMemberChanges, {worldId, id: tribeId});
    const memberChanges = [];

    for (const change of memberChangesRaw) {
        if (!utils.hasOwn(playersName, change.character_id)) {
            playersName[change.character_id] = (await db.one(sql.getPlayer, {worldId, playerId: change.character_id})).name;
        }

        memberChanges.push({
            player: {
                id: change.character_id,
                name: playersName[change.character_id]
            },
            type: change.old_tribe === tribeId ? memberChangeTypes.LEFT : memberChangeTypes.JOIN,
            date: change.date
        });
    }

    mergeBackendLocals(res, {
        marketId,
        worldNumber
    });

    res.render('stats', {
        page: 'stats/tribe-member-changes',
        title: i18n('stats_tribe_member_changes', 'page_titles', res.locals.lang, [tribe.tag, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        tribe,
        world,
        memberChanges,
        memberChangeTypes,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('tribe', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/tribes/${tribeId}`, replaces: [tribe.tag]},
            {label: i18n('member_changes', 'navigation', res.locals.lang)}
        ])
    });
});

const tribeAchievementsRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        tribeId,
        tribe
    } = await paramTribeParse(req, worldId);

    const world = await db.one(sql.getWorld, {worldId});

    const subCategory = req.params.subCategory;

    if (subCategory && subCategory !== 'detailed') {
        throw createError(404, i18n('router_missing_sub_page', 'errors', res.locals.lang));
    }

    const achievements = await db.any(sql.getTribeAchievements, {worldId, id: tribeId});
    const achievementsRepeatable = {};
    const achievementsRepeatableCategoryCount = {};
    let achievementsRepeatableGeralCount = 0;
    const achievementsRepeatableLastEarned = {};
    const achievementsRepeatableDetailed = {};

    for (const {period, type, time_last_level} of achievements) {
        if (period) {
            if (!achievementsRepeatableLastEarned[type]) {
                achievementsRepeatableLastEarned[type] = utils.ejsHelpers.formatDate(time_last_level, world.time_offset, 'day-only');
            }

            achievementsRepeatable[type] = achievementsRepeatable[type] || [];
            achievementsRepeatable[type].push(utils.ejsHelpers.formatDate(time_last_level, world.time_offset, 'day-only'));

            achievementsRepeatableCategoryCount[type] = achievementsRepeatableCategoryCount[type] ?? 0;
            achievementsRepeatableCategoryCount[type]++;
            achievementsRepeatableGeralCount++;

            if (subCategory === 'detailed') {
                achievementsRepeatableDetailed[type] = achievementsRepeatableDetailed[type] || [];
                achievementsRepeatableDetailed[type].push(utils.ejsHelpers.formatDate(time_last_level, world.time_offset, 'day-only'));
            }
        }
    }

    mergeBackendLocals(res, {
        marketId,
        worldNumber
    });

    res.render('stats', {
        page: 'stats/tribe-achievements',
        title: i18n('stats_tribe_achievements', 'page_titles', res.locals.lang, [tribe.tag, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        tribe,
        achievementsRepeatable,
        achievementsRepeatableCategoryCount,
        achievementsRepeatableGeralCount,
        achievementsRepeatableLastEarned,
        achievementsRepeatableDetailed,
        subCategory,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('tribe', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/tribes/${tribeId}`, replaces: [tribe.tag]},
            {label: i18n('achievements', 'navigation', res.locals.lang)}
        ])
    });
});

router.get('/stats/:marketId/:worldNumber/tribes/:tribeId', tribeRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:category?', tribeConquestsRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/conquests/:category?/page/:page', tribeConquestsRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/members', tribeMembersRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages', tribeVillagesRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/villages/page/:page', tribeVillagesRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/member-changes', tribeMembersChangeRouter);
router.get('/stats/:marketId/:worldNumber/tribes/:tribeId/achievements/:subCategory?', tribeAchievementsRouter);

module.exports = router;
