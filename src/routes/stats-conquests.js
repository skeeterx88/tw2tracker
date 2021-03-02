const express = require('express');
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

const conquestsRouter = utils.asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);

    const page = req.params.page && !isNaN(req.params.page)
        ? Math.max(1, parseInt(req.params.page, 10))
        : 1;
    const limit = config.ui.ranking_page_items_per_page;
    const offset = limit * (page - 1);

    const conquests = await db.any(sql.getWorldConquests, {worldId, offset, limit});
    const total = parseInt((await db.one(sql.getWorldConquestsCount, {worldId})).count, 10);

    res.render('stats/conquests', {
        title: i18n.page_titles.stats_world_conquests,
        marketId,
        worldNumber,
        world,
        conquests,
        pagination: createPagination(page, total, limit, req.path),
        navigation: createNavigation([
            {label: i18n.navigation.stats, url: '/'},
            {label: i18n.navigation.server, url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n.navigation.world, url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n.navigation.conquests}
        ]),
        backendValues: {
            marketId,
            worldNumber
        },
        ...utils.ejsHelpers
    });
});

router.get('/stats/:marketId/:worldNumber/conquests', conquestsRouter);
router.get('/stats/:marketId/:worldNumber/conquests/page/:page', conquestsRouter);

module.exports = router;
