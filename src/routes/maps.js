const fs = require('fs');
const path = require('path');
const express = require('express');
const createError = require('http-errors');
const router = express.Router();
const utils = require('../utils.js');
const config = require('../config.js');
const db = require('../db.js');
const sql = require('../sql.js');
const i18n = require('../i18n.js');
const languages = require('../languages.js');
const mapsAPIRouter = require('./maps-api.js');

const {
    createNavigation,
    mergeBackendLocals,
    asyncRouter
} = require('../router-helpers.js');

const worldRouter = asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next();
    }

    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);
    const worldId = marketId + worldNumber;

    try {
        await fs.promises.access(path.join('.', 'data', worldId, 'info'));
    } catch (error) {
        throw createError(404, i18n('missing_world', 'errors', res.locals.lang));
    }

    if (!await utils.schemaExists(worldId)) {
        throw createError(404, i18n('missing_world', 'errors', res.locals.lang));
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);
    const lastDataSyncDate = world.last_data_sync_date ? new Date(world.last_data_sync_date).getTime() : false;

    mergeBackendLocals(res, {
        marketId,
        worldNumber,
        worldName: world.name,
        lastDataSyncDate,
        staticMapExpireTime: config.sync.static_share_expire_time
    });

    res.render('maps/map', {
        title: i18n('maps_world_map', 'page_titles', res.locals.lang, [marketId.toUpperCase(), world.name, config.site_name]),
        marketId,
        world
    });
});

const mapShareRouter = asyncRouter(async function (req, res, next) {
    if (req.params.marketId.length !== 2 || isNaN(req.params.worldNumber)) {
        return next();
    }

    const mapShareId = req.params.mapShareId;
    const marketId = req.params.marketId;
    const worldNumber = parseInt(req.params.worldNumber, 10);

    let mapShare;

    const worldExists = await utils.schemaExists(marketId + worldNumber);

    if (!worldExists) {
        throw createError(404, i18n('missing_world', 'errors', res.locals.lang));
    }

    const world = await db.one(sql.getWorld, [marketId, worldNumber]);
    const lastDataSyncDate = world.last_data_sync_date ? new Date(world.last_data_sync_date).getTime() : false;

    try {
        mapShare = await db.one(sql.maps.getShareInfo, [mapShareId, marketId, worldNumber]);
    } catch (error) {
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
        mapShare
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
