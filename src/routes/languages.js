const config = require('../config.js');
const i18n = require('../i18n.js');

const languageRouter = async function (request, reply) {
    if (request.params.lang) {
        request.session.lang = request.params.lang || config('general', 'lang');
        return reply.redirect(request.headers.referer ? request.headers.referer : '/');
    }

    reply.view('languages.ejs', {
        title: i18n('languages', 'page_titles', reply.locals.lang, [config('general', 'site_name')])
    });
};

module.exports = function (fastify, opts, done) {
    fastify.get('/language', languageRouter);
    fastify.get('/language/:lang', languageRouter);
    done();
};
