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
    createNavigation,
    mergeBackendLocals,
    asyncRouter
} = require('../router-helpers.js');

const searchCategories = ['players', 'tribes', 'villages'];

const searchPostRedirectRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldNumber
    } = await paramWorldParse(req);

    const rawQuery = encodeURIComponent(req.body.query);
    const category = (req.body.category || '').toLowerCase();

    if (!searchCategories.includes(category)) {
        throw createError(404, i18n('router_missing_category', 'errors', res.locals.lang));
    }

    return res.redirect(303, `/stats/${marketId}/${worldNumber}/search/${category}/${rawQuery}`);
});

const searchGetRedirectRouter = asyncRouter(async function (req, res, next) {
    const {
        marketId,
        worldNumber
    } = await paramWorldParse(req);

    return res.redirect(302, `/stats/${marketId}/${worldNumber}`);
});

const categorySearchRouter = asyncRouter(async function (req, res, next) {
    const category = req.params.category;

    if (!searchCategories.includes(category)) {
        return next();
    }

    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);

    const page = req.params.page && !isNaN(req.params.page) ? Math.max(1, parseInt(req.params.page, 10)) : 1;
    const limit = config.ui.ranking_page_items_per_page;
    const offset = limit * (page - 1);

    const rawQuery = decodeURIComponent(req.params.query);

    if (!rawQuery) {
        throw createError(500, i18n('error_no_search', 'world_search', res.locals.lang));
    }

    if (rawQuery.length < 3) {
        throw createError(500, i18n('error_min_chars', 'world_search', res.locals.lang));
    }

    if (rawQuery.length > 20) {
        throw createError(500, i18n('error_max_chars', 'world_search', res.locals.lang));
    }

    const query = '%' + rawQuery + '%';
    const allResults = await db.any(sql.search[category], {worldId, query});
    const results = allResults.slice(offset, offset + limit);
    const total = allResults.length;

    mergeBackendLocals(res, {
        marketId,
        worldNumber
    });

    return res.render('stats', {
        page: 'stats/search',
        title: i18n('stats_search', 'page_titles', res.locals.lang, [rawQuery, marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        worldNumber,
        category,
        results,
        resultsCount: results.length,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('search', 'navigation', res.locals.lang), replaces: [rawQuery]},
        ])
    });
});

router.post('/stats/:marketId/:worldNumber/search/', searchPostRedirectRouter);
router.get('/stats/:marketId/:worldNumber/search/', searchGetRedirectRouter);
router.get('/stats/:marketId/:worldNumber/search/:category/:query', categorySearchRouter);
router.get('/stats/:marketId/:worldNumber/search/:category/:query/page/:page', categorySearchRouter);

module.exports = router;
