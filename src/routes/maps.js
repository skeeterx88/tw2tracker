const fs = require('fs');
const path = require('path');
const createError = require('http-errors');
const config = require('../config.js');
const {db, sql} = require('../db.js');
const i18n = require('../i18n.js');
const mapShareTypes = require('../types/map-share.js');
const mapsAPIRouter = require('./maps-api.js');

const {
    mergeBackendLocals,
    paramWorld,
    paramWorldParse
} = require('../router-helpers.js');

const worldRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    try {
        await fs.promises.access(path.join('.', 'data', worldId, 'info'));
    } catch (error) {
        throw createError(404, i18n('missing_world', 'errors', reply.locals.lang));
    }

    const world = await db.one(sql('get-world'), {worldId});
    const lastDataSyncDate = world.last_data_sync_date ? new Date(world.last_data_sync_date).getTime() : false;

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        worldName: world.name,
        lastDataSyncDate,
        staticMapExpireTime: config('sync', 'static_share_expire_time'),
        mapShareTypes
    });

    reply.view('maps/map.ejs', {
        title: i18n('maps_world_map', 'page_titles', reply.locals.lang, [marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        marketId,
        world
    });
};

const mapShareRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const mapShareId = request.params.mapShareId;
    const world = await db.one(sql('get-world'), {worldId});
    const lastDataSyncDate = world.last_data_sync_date ? new Date(world.last_data_sync_date).getTime() : false;
    const [mapShare] = await db.any(sql('maps/get-share-info'), [mapShareId, marketId, worldNumber]);

    if (!mapShare) {
        throw createError(404, i18n('missing_map_share', 'errors', reply.locals.lang));
    }

    mapShare.creation_date = new Date(mapShare.creation_date).getTime();
    mapShare.settings = JSON.parse(mapShare.settings);

    db.query(sql('maps/update-share-access'), [mapShareId]);

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        worldName: world.name,
        lastDataSyncDate,
        mapShare,
        mapShareTypes
    });

    reply.view('maps/map.ejs', {
        title: i18n('maps_world_map_shared', 'page_titles', reply.locals.lang, [marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        marketId,
        world
    });
};

module.exports = function (fastify, opts, done) {
    fastify.get('/maps/:marketId/:worldNumber', worldRouter);
    fastify.get('/maps/:marketId/:worldNumber/share/:mapShareId', mapShareRouter);
    fastify.register(mapsAPIRouter);
    done();
};
