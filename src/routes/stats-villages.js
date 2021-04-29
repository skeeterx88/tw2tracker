const {db, sql} = require('../db.js');
const config = require('../config.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    paramVillageParse,
    createNavigation,
    mergeBackendLocals
} = require('../router-helpers.js');

const villageRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const {
        villageId,
        village
    } = await paramVillageParse(request, worldId);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const conquests = await db.any(sql('get-village-conquests'), {worldId, villageId});

    mergeBackendLocals(reply, {
        marketId,
        worldNumber,
        village,
        mapHighlights: [village],
        mapHighlightsType: 'villages'
    });

    reply.view('stats.ejs', {
        page: 'stats/village',
        title: i18n('stats_village', 'page_titles', reply.locals.lang, [village.name, village.x, village.y, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        village,
        conquests,
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('village', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}/villages/${village.id}`, replaces: [village.name]}
        ])
    });
};

module.exports = function (fastify, opts, done) {
    fastify.get('/stats/:marketId/:worldNumber/villages/:villageId', villageRouter);
    done();
};
