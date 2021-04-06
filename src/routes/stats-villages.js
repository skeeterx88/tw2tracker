const express = require('express');
const router = express.Router();
const {db} = require('../db.js');
const sql = require('../sql.js');
const config = require('../config.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    paramVillageParse,
    createNavigation,
    mergeBackendLocals,
    asyncRouter
} = require('../router-helpers.js');

const villageRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const {
        villageId,
        village
    } = await paramVillageParse(req, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const conquests = await db.any(sql('get-village-conquests'), {worldId, villageId});

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        village,
        mapHighlights: [village],
        mapHighlightsType: 'villages'
    });

    res.render('stats', {
        page: 'stats/village',
        title: i18n('stats_village', 'page_titles', res.locals.lang, [village.name, village.x, village.y, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        village,
        conquests,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', res.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', res.locals.lang), url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('village', 'navigation', res.locals.lang), url: `/stats/${marketId}/${world.num}/villages/${village.id}`, replaces: [village.name]}
        ])
    });
});

router.get('/stats/:marketId/:worldNumber/villages/:villageId', villageRouter);

module.exports = router;
