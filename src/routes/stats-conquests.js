const {db, sql} = require('../db.js');
const config = require('../config.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    createPagination,
    createNavigation,
    mergeBackendLocals
} = require('../router-helpers.js');

const conquestsRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const market = await db.one(sql('get-market'), {marketId});
    const world = await db.one(sql('get-world'), {worldId});

    const page = request.params.page && !isNaN(request.params.page)
        ? Math.max(1, parseInt(request.params.page, 10))
        : 1;
    const limit = config('ui', 'ranking_page_items_per_page');
    const offset = limit * (page - 1);

    const conquests = await db.any(sql('get-world-conquests'), {worldId, offset, limit});
    const total = parseInt((await db.one(sql('get-world-conquests-count'), {worldId})).count, 10);

    mergeBackendLocals(reply, {
        marketId,
        worldNumber
    });

    reply.view('stats.ejs', {
        page: 'stats/conquests',
        title: i18n('stats_world_conquests', 'page_titles', reply.locals.lang, [marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        market,
        marketId,
        worldNumber,
        world,
        conquests,
        pagination: createPagination(page, total, limit, request.url),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n(world.open ? 'world' : 'world_closed', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.world_number}`, replaces: [world.name]},
            {label: i18n('conquests', 'navigation', reply.locals.lang)}
        ])
    });
};

module.exports = function (fastify, opts, done) {
    fastify.get('/stats/:marketId/:worldNumber/conquests', conquestsRouter);
    fastify.get('/stats/:marketId/:worldNumber/conquests/page/:page', conquestsRouter);
    done();
};
