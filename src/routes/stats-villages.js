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
    paramVillageParse,
    createNavigation
} = require('../router-helpers.js');

const villageRouter = utils.asyncRouter(async function (req, res, next) {
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

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);

    const conquests = await db.any(sql.getVillageConquests, {worldId, villageId});

    res.render('stats/village', {
        title: i18n.page_titles.stats_village,
        marketId,
        worldNumber,
        world,
        village,
        conquests,
        navigation: createNavigation([
            {label: i18n.navigation.stats, url: '/'},
            {label: i18n.navigation.server, url: `/stats/${marketId}/`, replaces: [marketId.toUpperCase()]},
            {label: i18n.navigation.world, url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n.navigation.village, url: `/stats/${marketId}/${world.num}/villages/${village.id}`, replaces: [village.name]}
        ]),
        backendValues: {
            marketId,
            worldNumber,
            village,
            mapHighlights: [village],
            mapHighlightsType: 'villages'
        }
    });
});

router.get('/stats/:marketId/:worldNumber/villages/:villageId', villageRouter);

module.exports = router;
