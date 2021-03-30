module.exports = function () {
    const express = require('express');
    const session = require('express-session');
    const connectPgSimple = require('connect-pg-simple');
    const createError = require('http-errors');
    const compression = require('compression');
    const http = require('http');
    const path = require('path');
    const cookieParser = require('cookie-parser');
    const passport = require('passport');
    const passportLocal = require('passport-local');
    const connectFlash = require('connect-flash');
    const bcrypt = require('bcrypt');
    const pgArray = require('pg').types.arrayParser;
    const fs = require('fs');

    const {db} = require('./db.js');
    const sql = require('./sql.js');
    const config = require('./config.js');
    const authErrors = require('./auth-errors.json');
    const i18n = require('./i18n.js');
    const languages = require('./languages.js');
    const utils = require('./utils.js');
    const availableLanguages = fs.readdirSync('./i18n').map(file => path.parse(file).name);
    const rankingSortTypes = require('./ranking-sort-types.json');

    const development = process.env.NODE_ENV === 'development';
    const httpServer = http.createServer();
    const port = isNaN(process.env.PORT) ? 3000 : process.env.PORT;
    const app = express();

    if (!development && config('general', 'force_https')) {
        app.use(function (req, res, next) {
            if (req.headers['x-forwarded-proto'] === 'https') {
                next();
            } else {
                res.redirect('https://' + req.hostname + req.url);
            }
        });
    }

    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');

    app.use(compression({level: 9}));
    app.use(express.json());
    app.use(express.urlencoded({extended: false}));
    app.use(cookieParser());
    app.use(express.static(path.join(__dirname, 'public')));

    const sessionSecret = process.env.TW2TRACKER_SESSION_SECRET;

    if (!sessionSecret) {
        throw new Error('Missing environment session secret TW2TRACKER_SESSION_SECRET');
    }

    app.use(session({
        store: new (connectPgSimple(session))({
            pgPromise: db,
            schemaName: 'public',
            tableName: 'session'
        }),
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 30 * 24 * 60 * 60 * 1000
        },
        name: 'tw2tracker-session'
    }));

    passport.use(new passportLocal.Strategy({
        passReqToCallback: true
    }, async function (req, name, pass, done) {
        const [account] = await db.any(sql.getModAccountByName, {name});

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
        const privilegeEntries = await db.map(sql.getModPrivilegeTypes, [], ({type}) => [type, parsedPrivileges.includes(type)]);
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

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(connectFlash());

    const languagesRouter = require('./routes/languages.js');
    const statsRouter = require('./routes/stats.js');
    const adminRouter = require('./routes/admin.js');
    const mapsRouter = require('./routes/maps.js');

    app.use(function (req, res, next) {
        res.locals.i18n = i18n;
        res.locals.availableLanguages = availableLanguages;
        res.locals.formatNumbers = utils.formatNumbers;
        res.locals.formatDate = utils.formatDate;
        res.locals.formatSince = utils.formatSince;
        res.locals.capitalize = utils.capitalize;
        res.locals.sprintf = utils.sprintf;
        res.locals.lang = req.session.lang || config('general', 'lang');
        res.locals.tribeRankingSortField = req.session.tribeRankingSortField || rankingSortTypes.VICTORY_POINTS;
        res.locals.playerRankingSortField = req.session.playerRankingSortField || rankingSortTypes.VICTORY_POINTS;
        res.locals.user = req.session.passport ? req.session.passport.user : {};

        res.locals.backendValues = {
            selectedLanguage: res.locals.lang,
            language: languages[res.locals.lang],
            development
        };

        next();
    });

    app.use('/', statsRouter);
    app.use('/admin', adminRouter);
    app.use('/maps', mapsRouter);
    app.use('/language', languagesRouter);

    // temporary
    app.use('/login', function (req, res) {
        res.redirect('/admin/login');
    });

    // catch 404 and forward to error handler
    app.use(function (req, res, next) {
        next(createError(404));
    });

    // error handler
    app.use(function (err, req, res, next) {
        const status = err.status || 500;
        res.locals.error = err;
        res.locals.status = status;
        res.locals.title = i18n('header_error', 'errors', req.session.lang, [status]) + ' - ' + config('general', 'site_name');
        res.locals.config = config;
        res.locals.development = development;

        res.status(status).render('error');
    });

    app.set('port', port);

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
