// TW2-Tracker
// Copyright (C) 2021 Relaxeaza
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const connectPgSimple = require('connect-pg-simple');
const createError = require('http-errors');

const fastifyView = require('point-of-view');
const fastifyStatic = require('fastify-static');
const fastifySession = require('fastify-session');
const fastifyCookie = require('fastify-cookie');
const fastifyBodyParser = require('fastify-formbody');
const ejs = require('ejs');

const {db} = require('./db.js');
const config = require('./config.js');
const i18n = require('./i18n.js');

const languages = require('./languages.js');
const utils = require('./utils.js');
const timeUtils = require('./time-utils.js');
const rankingSortTypes = require('./types/ranking-sort.js');

const availableLanguages = fs.readdirSync('./i18n').map(function (file) {
    const id = path.parse(file).name;
    return [id, i18n('language', 'meta', id)];
});

const SessionStore = connectPgSimple(fastifySession);
const sessionOptions = {
    name: 'tw2tracker-session',
    secret: process.env.TW2TRACKER_SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: new SessionStore({
        pgPromise: db,
        schemaName: 'public',
        tableName: 'session'
    }),
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: false
    }
};

const statsRouter = require('./routes/stats.js');
const mapsRouter = require('./routes/maps.js');
const languageRouter = require('./routes/languages.js');
const adminRouter = require('./routes/admin.js');
const overflowRouter = require('./routes/overflow.js');

module.exports = async function () {
    const fastify = Fastify({
        trustProxy: true
    });

    fastify.register(fastifyView, {
        engine: {ejs},
        root: path.join(__dirname, 'views')
    });

    fastify.register(fastifyStatic, {
        root: path.join(__dirname, 'public')
    });

    fastify.register(fastifyBodyParser);
    fastify.register(fastifyCookie);
    fastify.register(fastifySession, sessionOptions);

    fastify.decorateRequest('flash', function (type, msg) {
        const msgs = this.session.flash = this.session.flash || {};

        if (type && msg) {
            return (msgs[type] = msgs[type] || []).push(msg);
        } else if (type) {
            const arr = msgs[type];
            delete msgs[type];
            return arr || [];
        }
    });

    fastify.decorateReply('locals', null);
    fastify.addHook('preHandler', async function (request, reply) {
        reply.locals = {};
        reply.locals.availableLanguages = availableLanguages;
        reply.locals.formatDate = timeUtils.formatDate;
        reply.locals.formatSince = timeUtils.formatSince;
        reply.locals.capitalize = utils.capitalize;
        reply.locals.sprintf = utils.sprintf;
        reply.locals.lang = request.session.lang || config('general', 'lang');
        reply.locals.tribeRankingSortField = request.session.tribeRankingSortField || rankingSortTypes.RANK;
        reply.locals.playerRankingSortField = request.session.playerRankingSortField || rankingSortTypes.RANK;
        reply.locals.account = request.session.account;

        reply.locals.formatNumbers = function (value, options) {
            return utils.formatNumbers(value, languages[reply.locals.lang].meta.code, options);
        };

        reply.locals.i18n = function (key, namespace, tokens) {
            return i18n(key, namespace, reply.locals.lang, tokens);
        };

        reply.locals.backendValues = {
            selectedLanguage: reply.locals.lang,
            language: languages[reply.locals.lang]
        };
    });

    fastify.register(statsRouter);
    fastify.register(mapsRouter);
    fastify.register(languageRouter);
    fastify.register(adminRouter);
    fastify.register(overflowRouter);

    fastify.setNotFoundHandler(function (request) {
        throw createError(404, i18n('router_not_found', 'errors', request.session.lang));
    });

    fastify.setErrorHandler((error, request, reply) => {
        const status = error.status || 500;

        reply.view('error.ejs', {
            title: i18n('header_error', 'errors', request.session.lang, [status]) + ' - ' + config('general', 'site_name'),
            showStack: process.env.NODE_ENV === 'development',
            issuesEmail: config('emails', 'issues'),
            error,
            status
        });
    });

    fastify.listen(3000, (err) => {
        if (err) {
            throw err;
        }
    });
};
