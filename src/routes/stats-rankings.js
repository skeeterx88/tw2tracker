const createError = require('http-errors');
const {db, sql} = require('../db.js');
const utils = require('../utils.js');
const config = require('../config.js');
const i18n = require('../i18n.js');

const {
    paramWorld,
    paramWorldParse,
    createPagination,
    createNavigation,
    mergeBackendLocals,
    parseRankingSort
} = require('../router-helpers.js');

const rankingCategories = ['players', 'tribes'];

const rankingRouterSqlMap = {
    players: {
        ranking: sql('get-world-ranking-players'),
        count: sql('get-world-player-count')
    },
    tribes: {
        ranking: sql('get-world-ranking-tribes'),
        count: sql('get-world-tribe-count')
    }
};

const rankingCategoryRouter = async function (request, reply, done) {
    if (!paramWorld(request)) {
        return done();
    }

    const {
        marketId,
        worldId,
        worldNumber
    } = await paramWorldParse(request);

    const category = request.params.category;

    if (!rankingCategories.includes(category)) {
        throw createError(404, i18n('router_missing_category', 'errors', reply.locals.lang));
    }

    const page = request.params.page && !isNaN(request.params.page)
        ? Math.max(1, parseInt(request.params.page, 10))
        : 1;
    const limit = parseInt(config('ui', 'ranking_page_items_per_page'), 10);
    const offset = limit * (page - 1);

    const world = await db.one(sql('get-world'), {worldId});

    const {
        playerRankingSortField,
        playerRankingSortOrder,
        tribeRankingSortField,
        tribeRankingSortOrder
    } = parseRankingSort(request, world.config.victory_points);

    const sortField = category === 'players' ? playerRankingSortField : tribeRankingSortField;
    const sortOrder = category === 'players' ? playerRankingSortOrder : tribeRankingSortOrder;

    const ranking = await db.any(rankingRouterSqlMap[category].ranking, {worldId, offset, limit, sortField, sortOrder});
    const {count} = await db.one(rankingRouterSqlMap[category].count, {worldId});
    const total = parseInt(count, 10);
    const capitalizedCategory = utils.capitalize(category);

    if (!world.config.victory_points && offset < config('ui', 'ranking_page_items_per_page')) {
        const topTenVillages = ranking.slice(0, 10).reduce((villages, tribe) => villages + tribe.villages, 0);

        for (let i = 0; i < 10; i++) {
            ranking[i].domination = parseFloat((ranking[i].villages / topTenVillages * 100).toFixed(1));
        }
    }

    mergeBackendLocals(reply, {
        marketId,
        worldNumber
    });

    reply.view('stats.ejs', {
        page: 'stats/ranking',
        title: i18n('stats_ranking', 'page_titles', reply.locals.lang, [capitalizedCategory, marketId.toUpperCase(), world.name, config('general', 'site_name')]),
        marketId,
        worldNumber,
        worldName: world.name,
        world,
        ranking,
        category,
        sortField,
        pagination: createPagination(page, total, limit, request.url),
        navigation: createNavigation([
            {label: i18n('stats', 'navigation', reply.locals.lang), url: '/'},
            {label: i18n('server', 'navigation', reply.locals.lang), url: `/stats/${marketId}`, replaces: [marketId.toUpperCase()]},
            {label: i18n('world', 'navigation', reply.locals.lang), url: `/stats/${marketId}/${world.num}`, replaces: [world.name]},
            {label: i18n('ranking', 'navigation', reply.locals.lang), replaces: [capitalizedCategory]}
        ])
    });
};

module.exports = function (fastify, opts, done) {
    fastify.get('/stats/:marketId/:worldNumber/ranking/:category', rankingCategoryRouter);
    fastify.get('/stats/:marketId/:worldNumber/ranking/:category/page/:page', rankingCategoryRouter);
    done();
};
