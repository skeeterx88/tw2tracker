const createError = require('http-errors');
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

const searchCategories = ['players', 'tribes', 'villages'];

const searchPostRedirectRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldNumber
    } = await paramWorldParse(request);

    const rawQuery = encodeURIComponent(request.body.query);
    const category = (request.body.category || '').toLowerCase();

    if (!searchCategories.includes(category)) {
        throw createError(404, i18n('router_missing_category', 'errors', reply.locals.lang));
    }

    return reply.redirect(303, `/stats/${marketId}/${worldNumber}/search/${category}/${rawQuery}`);
};

const searchGetRedirectRouter = async function (request, reply) {
    const {
        marketId,
        worldNumber
    } = await paramWorldParse(request);

    return reply.redirect(302, `/stats/${marketId}/${worldNumber}`);
};

const categorySearchRouter = async function (request, reply, done) {
    const category = request.params.category;

    if (!searchCategories.includes(category)) {
        return done();
    }

    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const world = await db.one(sql('get-world'), {worldId});

    const page = request.params.page && !isNaN(request.params.page) ? Math.max(1, parseInt(request.params.page, 10)) : 1;
    const limit = config('ui', 'ranking_page_items_per_page');
    const offset = limit * (page - 1);

    const rawQuery = decodeURIComponent(request.params.query);

    if (!rawQuery) {
        throw createError(500, i18n('error_no_search', 'world_search', reply.locals.lang));
    }

    if (rawQuery.length < config('search', 'min_search_characters')) {
        throw createError(500, i18n('error_min_chars', 'world_search', reply.locals.lang, [config('search', 'min_search_characters')]));
    }

    if (rawQuery.length > config('search', 'max_search_characters')) {
        throw createError(500, i18n('error_max_chars', 'world_search', reply.locals.lang, [config('search', 'max_search_characters')]));
    }

    const query = '%' + rawQuery + '%';
    const allResults = await db.any(sql('search/' + category), {worldId, query});
    const results = allResults.slice(offset, offset + limit);
    const total = allResults.length;

    mergeBackendLocals(reply, {
        marketId,
        worldNumber
    });

    return reply.view('stats.ejs', {
        page: 'stats/search',
        title: i18n('stats_search', 'page_titles', reply.locals.lang, [rawQuery, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        marketId,
        worldNumber,
        category,
        results,
        resultsCount: results.length,
        pagination: createPagination(page, total, limit, request.url),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('search', 'navigation', reply.locals.lang), replaces: [rawQuery]}
        ])
    });
};

module.exports = function (fastify, opts, done) {
    fastify.post('/stats/:marketId/:worldNumber/search', searchPostRedirectRouter);
    fastify.get('/stats/:marketId/:worldNumber/search', searchGetRedirectRouter);
    fastify.get('/stats/:marketId/:worldNumber/search/:category/:query', categorySearchRouter);
    fastify.get('/stats/:marketId/:worldNumber/search/:category/:query/page/:page', categorySearchRouter);
    done();
};
