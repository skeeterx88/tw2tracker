const fs = require('fs');
const path = require('path');
const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const config = require('../config.js');
const db = require('../db.js');
const sql = require('../sql.js');
const i18n = require('../i18n.js');
const mapShareTypes = require('../map-share-types.json');
const mapsAPIRouter = require('./maps-api.js');

const {
    mergeBackendLocals,
    asyncRouter,
    paramWorld,
    paramWorldParse
} = require('../router-helpers.js');

const worldRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(req);

    try {
        await fs.promises.access(path.join('.', 'data', worldId, 'info'));
    } catch (error) {
        throw createError(404, i18n('missing_world', 'errors', res.locals.lang));
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);
    const lastDataSyncDate = world.last_data_sync_date ? new Date(world.last_data_sync_date).getTime() : false;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        worldName: world.name,
        lastDataSyncDate,
        staticMapExpireTime: config.sync.static_share_expire_time,
        mapShareTypes
    });

    res.render('maps/map', {
        title: i18n('maps_world_map', 'page_titles', res.locals.lang, [marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        world
    });
});

const mapShareRouter = asyncRouter(async function (req, res, next) {
    if (!paramWorld(req)) {
        return next();
    }

    const {
        marketId,
        worldNumber
    } = await paramWorldParse(req);

    const mapShareId = req.params.mapShareId;
    const world = await db.one(sql.getWorld, [marketId, worldNumber]);
    const lastDataSyncDate = world.last_data_sync_date ? new Date(world.last_data_sync_date).getTime() : false;
    const [mapShare] = await db.any(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber]);

    if (!mapShare) {
        throw createError(404, i18n('missing_map_share', 'errors', res.locals.lang));
    }

    mapShare.creation_date = new Date(mapShare.creation_date).getTime();
    mapShare.settings = JSON.parse(mapShare.settings);

    db.query(sql.maps.updateShareAccess, [mapShareId]);

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        worldName: world.name,
        lastDataSyncDate,
        mapShare,
        mapShareTypes
    });

    res.render('maps/map', {
        title: i18n('maps_world_map_shared', 'page_titles', res.locals.lang, [marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        world
    });
});

router.get('/:marketId/:worldNumber', worldRouter);
router.get('/:marketId/:worldNumber/share/:mapShareId', mapShareRouter);
router.use(mapsAPIRouter);

module.exports = router;
