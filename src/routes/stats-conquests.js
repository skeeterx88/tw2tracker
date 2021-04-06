const express = require('express');
const router = express.Router();
const {db} = require('../db.js');
const sql = require('../sql.js');
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

const conquestsRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1;
    const limit = config('ui', 'ranking_page_items_per_page');
    const offset = limit * (page - 1);

    const conquests = await db.any(sql('get-world-conquests'), {worldId, offset, limit});
    const total = parseInt((await db.one(sql('get-world-conquests-count'), {worldId})).count, 10);

    mergeBackendLocals(res, {
        marketId,
        worldNumber
    });

    res.render('stats', {
        page: 'stats/conquests',
        title: i18n('stats_world_conquests', 'page_titles', res.locals.lang, [marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        conquests,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('conquests', 'navigation', res.locals.lang)}
        ])
    });
});

router.get('/stats/:marketId/:worldNumber/conquests', conquestsRouter);
router.get('/stats/:marketId/:worldNumber/conquests/page/:page', conquestsRouter);

module.exports = router;
