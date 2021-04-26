const fs = require('fs');
const path = require('path');
const createError = require('http-errors');

const {db, sql} = require('../db.js');
const utils = require('../utils.js');
const i18n = require('../i18n.js');
const mapShareTypes = require('../types/map-share.js');

const {
    paramWorldParse
} = require('../router-helpers.js');

const GZIP_EMPTY_CONTINENT = Buffer.from([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 171, 174, 5, 0, 67, 191, 166, 163, 2, 0, 0, 0]);

const getWorldInfoRouter = async function (request, reply) {
    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    let dataPath;

    if (request.params.mapShareId) {
        const mapShare = await db.one(sql('maps/get-share-info'), [request.params.mapShareId, marketId, worldNumber]);
        const dateId = utils.getHourlyDir(mapShare.creation_date);
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, 'info');
    } else {
        dataPath = path.join('.', 'data', worldId, 'info');
    }

    try {
        await fs.promises.access(dataPath);
    } catch (error) {
        throw createError(500, i18n('map_share_not_found', 'errors', reply.locals.lang));
    }

    const ifNoneMatchValue = request.headers['if-none-match'];
    const dataStats = await fs.promises.lstat(dataPath);
    const etag = utils.sha1sum(dataStats.mtime.toISOString());

    if (ifNoneMatchValue && ifNoneMatchValue === etag) {
        reply.status(304);
        return reply.send();
    }

    const data = await fs.promises.readFile(dataPath);

    reply.header('Content-Encoding', 'gzip');
    reply.header('Cache-Control', 'no-cache, max-age=31536000');
    reply.header('Vary', 'ETag');
    reply.header('ETag', etag);
    reply.send(data);
};

const getOpenWorldsRouter = async function (request, reply) {
    const allWorlds = await db.any(sql('get-open-worlds'));
    reply.header('Content-Type', 'application/json');
    reply.send(JSON.stringify(allWorlds));
};

const getMarketsRouters = async function (request, reply) {
    const marketsWithAccounts = await db.map(sql('get-markets-with-accounts'), [], market => market.id);
    reply.header('Content-Type', 'application/json');
    reply.send(JSON.stringify(marketsWithAccounts));
};

const getContinentRouter = async function (request, reply) {
    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const continentId = request.params.continentId;

    if (continentId < 0 || continentId > 99 || isNaN(continentId)) {
        throw createError(400, i18n('error_invalid_continent', 'maps', reply.locals.lang));
    }

    let dataPath;

    if (request.params.mapShareId) {
        const mapShare = await db.one(sql('maps/get-share-info'), [request.params.mapShareId, marketId, worldNumber]);
        const dateId = utils.getHourlyDir(mapShare.creation_date);
        dataPath = path.join('.', 'data', 'static-maps', worldId, dateId, continentId);
    } else {
        dataPath = path.join('.', 'data', worldId, continentId);
    }

    let data;
    let etag;

    const ifNoneMatchValue = request.headers['if-none-match'];

    reply.header('Content-Encoding', 'gzip');
    reply.header('Cache-Control', 'no-cache, max-age=31536000');
    reply.header('Vary', 'ETag');

    try {
        await fs.promises.access(dataPath);
        const dataStats = await fs.promises.lstat(dataPath);
        etag = utils.sha1sum(dataStats.mtime.toISOString());

        if (ifNoneMatchValue && ifNoneMatchValue === etag) {
            reply.status(304);
            return reply.send();
        }

        data = await fs.promises.readFile(dataPath);
    } catch (error) {
        etag = 'empty_continent';

        if (ifNoneMatchValue && ifNoneMatchValue === etag) {
            reply.status(304);
            return reply.send();
        }

        data = GZIP_EMPTY_CONTINENT;
    }

    reply.header('ETag', etag);
    reply.send(data);
};

const getStructRouter = async function (request, reply) {
    const {
        worldId
    } = await paramWorldParse(request);

    const structPath = path.join('.', 'data', worldId, 'struct');

    try {
        await fs.promises.access(structPath);
    } catch (error) {
        throw createError(500, i18n('error_struct_not_found', 'maps', reply.locals.lang));
    }

    const ifNoneMatchValue = request.headers['if-none-match'];
    const structStats = await fs.promises.lstat(structPath);
    const etag = utils.sha1sum(structStats.mtime.toISOString());

    if (ifNoneMatchValue && ifNoneMatchValue === etag) {
        reply.status(304);
        return reply.send();
    }

    const struct = await fs.promises.readFile(structPath);

    reply.header('Content-Encoding', 'gzip');
    reply.header('Cache-Control', 'no-cache, max-age=31536000');
    reply.header('Vary', 'ETag');
    reply.header('ETag', etag);
    reply.send(struct);
};

const crateShareRouter = async function (request, reply) {
    const {
        marketId,
        worldNumber,
        highlights,
        shareType,
        settings,
        center
    } = request.body;

    const worldId = marketId + worldNumber;
    const [worldExists] = await db.any(sql('helpers/schema-exists'), {schema: worldId});

    if (!worldExists) {
        reply.status(404);
        reply.send(i18n('error_world_not_found', 'maps', reply.locals.lang));
        return;
    }

    if (!highlights || !Array.isArray(highlights)) {
        reply.status(400);
        reply.send(i18n('error_invalid_highlights', 'maps', reply.locals.lang));
        return;
    }

    if (!highlights.length) {
        reply.status(400);
        reply.send(i18n('error_no_highlights_input', 'maps', reply.locals.lang));
        return;
    }

    const highlightsString = JSON.stringify(highlights);
    const shareId = utils.makeid(20);

    const settingsString = JSON.stringify(settings);
    const {creation_date} = await db.one(sql('maps/create-share'), [shareId, marketId, worldNumber, shareType, highlightsString, settingsString, center.x, center.y]);

    if (shareType === mapShareTypes.STATIC) {
        const dateId = utils.getHourlyDir(creation_date);
        const worldId = marketId + worldNumber;
        const copyDestination = path.join('.', 'data', 'static-maps', worldId, dateId);

        try {
            await fs.promises.access(copyDestination);
        } catch (e) {
            const worldDataLocation = path.join('.', 'data', worldId);
            const worldData = await fs.promises.readdir(worldDataLocation);
            const toCopy = worldData.filter((file) => file !== 'struct');

            await fs.promises.mkdir(copyDestination, {recursive: true});

            for (const file of toCopy) {
                await fs.promises.copyFile(
                    path.join(worldDataLocation, file),
                    path.join(copyDestination, file)
                );
            }
        }
    }

    reply.send(`/maps/${marketId}/${worldNumber}/share/${shareId}`);
};

const getShareRouter = async function (request, reply) {
    const {
        mapShareId,
        marketId,
        worldNumber,
        highlightsOnly
    } = request.body;

    const worldId = marketId + worldNumber;
    const [worldExists] = await db.any(sql('helpers/schema-exists'), {schema: worldId});

    if (!worldExists) {
        reply.status(404);
        reply.send(i18n('map_share_not_found', 'errors', reply.locals.lang));
        return;
    }

    try {
        const shareSql = highlightsOnly ? sql('maps/get-share-highlights') : sql('maps/get-share-info');
        const mapShare = await db.one(shareSql, [mapShareId, marketId, worldNumber]);

        reply.header('Content-Type', 'application/json');
        reply.send(JSON.stringify(mapShare));
    } catch (error) {
        reply.status(404);
        reply.send(i18n('map_share_not_found', 'errors', reply.locals.lang));
    }
};

module.exports = function (fastify, opts, done) {
    fastify.get('/maps/api/:marketId/:worldNumber/info', getWorldInfoRouter);
    fastify.get('/maps/api/:marketId/:worldNumber/info/:mapShareId', getWorldInfoRouter);
    fastify.get('/maps/api/get-open-worlds', getOpenWorldsRouter);
    fastify.get('/maps/api/get-markets', getMarketsRouters);
    fastify.get('/maps/api/:marketId/:worldNumber/continent/:continentId', getContinentRouter);
    fastify.get('/maps/api/:marketId/:worldNumber/continent/:continentId/:mapShareId', getContinentRouter);
    fastify.get('/maps/api/:marketId/:worldNumber/struct', getStructRouter);
    fastify.post('/maps/api/create-share', crateShareRouter);
    fastify.post('/maps/api/get-share', getShareRouter);
    done();
};
