module.exports = function () {
    const express = require('express');
    const session = require('express-session');
    const connectPgSimple = require('connect-pg-simple');
    const createError = require('http-errors');
    const http = require('http');
    const path = require('path');
    const cookieParser = require('cookie-parser');
    const passport = require('passport');
    const passportLocal = require('passport-local');
    const connectFlash = require('connect-flash');
    const bcrypt = require('bcrypt');
    const pgArray = require('pg').types.arrayParser;
    const fs = require('fs');

    const {db, sql} = require('./db.js');
    const config = require('./config.js');
    const authErrors = require('./types/auth-error.js');
    const i18n = require('./i18n.js');
    const languages = require('./languages.js');
    const utils = require('./utils.js');
    const timeUtils = require('./time-utils.js');
    const availableLanguages = fs.readdirSync('./i18n').map(file => path.parse(file).name);
    const rankingSortTypes = require('./types/ranking-sort.js');

    const development = process.env.NODE_ENV === 'development';
    const port = parseInt(process.env.PORT, 10) || 3000;
    const app = express();

    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.set('x-powered-by', false);
    app.set('trust proxy', true);
    app.set('trust proxy', 'loopback');

    app.use(express.json());
    app.use(express.urlencoded({extended: false}));
    app.use(cookieParser());
    app.use(express.static(path.join(__dirname, 'public')));

    if (!process.env.TW2TRACKER_SESSION_SECRET) {
        throw new Error('Missing environment session secret TW2TRACKER_SESSION_SECRET');
    }

    app.use(session({
        store: new (connectPgSimple(session))({
            pgPromise: db,
            schemaName: 'public',
            tableName: 'session'
        }),
        secret: process.env.TW2TRACKER_SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 30 * 24 * 60 * 60 * 1000
        },
        name: 'tw2tracker-session'
    }));

    passport.use('local', new passportLocal.Strategy({
        passReqToCallback: true
    }, async function (req, name, pass, done) {
        const [account] = await db.any(sql('get-mod-account-by-name'), {name});

        if (!account) {
            return done(null, false, {
                message: i18n(authErrors.ACCOUNT_NOT_EXIST, 'admin')
            });
        }

        if (!account.enabled) {
            return done(null, false, {
                message: i18n(authErrors.ACCOUNT_NOT_ENABLED, 'admin')
            });
        }

        const match = await bcrypt.compare(pass, account.pass);

        if (!match) {
            return done(null, false, {
                message: i18n(authErrors.INVALID_PASSWORD, 'admin')
            });
        }

        done(null, account);
    }));

    passport.serializeUser(async function (account, callback) {
        const parsedPrivileges = typeof account.privileges === 'string' ? pgArray.create(account.privileges, String).parse() : account.privileges;
        const privilegeEntries = await db.map(sql('get-mod-privilege-types'), [], ({type}) => [type, parsedPrivileges.includes(type)]);
        const privilegeObject = Object.fromEntries(privilegeEntries);

        callback(null, {
            id: account.id,
            name: account.name,
            privileges: privilegeObject
        });
    });

    passport.deserializeUser(function (user, callback) {
        callback(null, user);
    });

    app.use(passport.initialize({}));
    app.use(passport.session({}));
    app.use(connectFlash());
    app.use(function (req, res, next) {
        res.locals.i18n = i18n;
        res.locals.availableLanguages = availableLanguages;
        res.locals.formatNumbers = utils.formatNumbers;
        res.locals.formatDate = timeUtils.formatDate;
        res.locals.formatSince = timeUtils.formatSince;
        res.locals.capitalize = utils.capitalize;
        res.locals.sprintf = utils.sprintf;
        res.locals.lang = req.session.lang || config('general', 'lang');
        res.locals.tribeRankingSortField = req.session.tribeRankingSortField || rankingSortTypes.VICTORY_POINTS;
        res.locals.playerRankingSortField = req.session.playerRankingSortField || rankingSortTypes.VICTORY_POINTS;
        res.locals.user = req.session.passport ? req.session.passport.user : {};

        res.locals.backendValues = {
            selectedLanguage: res.locals.lang,
            language: languages[res.locals.lang],
            development: development
        };

        next();
    });

    app.use('/', require('./routes/stats.js'));
    app.use('/admin', require('./routes/admin.js'));
    app.use('/maps', require('./routes/maps.js'));
    app.use('/language', require('./routes/languages.js'));
    app.use('/overflow', require('./routes/overflow.js'));

    // catch 404 and forward to error handler
    app.use(function (req, res, next) {
        next(createError(404));
    });

    // error handler
    app.use(function (err, req, res) {
        const status = err.status || 500;
        res.locals.error = err;
        res.locals.status = status;
        res.locals.title = i18n('header_error', 'errors', req.session.lang, [status]) + ' - ' + config('general', 'site_name');
        res.locals.config = config;
        res.locals.development = development;

        res.status(status).render('error');
    });

    const httpServer = http.createServer();

    httpServer.on('request', app);
    httpServer.on('error', function (error) {
        if (error.syscall !== 'listen') {
            throw error;
        }

        const bind = typeof port === 'string'
            ? `Pipe ${port}`
            : `Port ${port}`;

        switch (error.code) {
            case 'EACCES': {
                console.error(`${bind} requires elevated privileges`);
                process.exit(1);
                break;
            }
            case 'EADDRINUSE': {
                console.error(`${bind} is already in use`);
                process.exit(1);
                break;
            }
            default: {
                throw error;
            }
        }
    });

    httpServer.listen(port);
};
