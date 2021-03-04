const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const db = require('../db.js');
const sql = require('../sql.js');
const utils = require('../utils.js');
const config = require('../config.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    createPagination,
    createNavigation
} = require('../router-helpers.js');

const rankingCategories = ['players', 'tribes'];

const rankingRouterSqlMap = {
    players: {
        ranking: sql.getWorldRankingPlayers,
        count: sql.getWorldPlayerCount
    },
    tribes: {
        ranking: sql.getWorldRankingTribes,
        count: sql.getWorldTribeCount
    }
};

const rankingCategoryRouter = utils.asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);

    const category = req.params.category;

    if (!rankingCategories.includes(category)) {
        throw createError(404, i18n('router_missing_category', 'errors', res.locals.lang));
    }

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1;
    const limit = parseInt(config.ui.ranking_page_items_per_page, 10);
    const offset = limit * (page - 1);

    const ranking = await db.any(rankingRouterSqlMap[category].ranking, {worldId, offset, limit});
    const {count} = await db.one(rankingRouterSqlMap[category].count, {worldId});
    const total = parseInt(count, 10);
    const capitalizedCategory = utils.capitalize(category);

    res.render('stats', {
        page: 'stats/ranking',
        title: i18n('stats_ranking', 'page_titles', res.locals.lang, [capitalizedCategory, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        worldName: world.name,
        world,
        ranking,
        category,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('ranking', 'navigation', res.locals.lang), replaces: [capitalizedCategory]},
        ]),
        backendValues: {
            marketId,
            worldNumber
        }
    });
});

router.get('/stats/:marketId/:worldNumber/ranking/:category?/', rankingCategoryRouter);
router.get('/stats/:marketId/:worldNumber/ranking/:category?/page/:page', rankingCategoryRouter);

module.exports = router;
