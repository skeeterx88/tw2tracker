const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const createError = require('http-errors');
const compression = require('compression');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const passportLocal = require('passport-local');
const connectFlash = require('connect-flash');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const pgArray = require('pg').types.arrayParser;

const db = require('./db.js');
const sql = require('./sql.js');
const config = require('./config.js');
const enums = require('./enums.js');
const i18n = require('./i18n.js');

const port = isNaN(process.env.PORT) ? 3000 : process.env.PORT;
const app = express();

if (process.env.NODE_ENV === 'production') {
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
app.use(session({
    store: new (connectPgSimple(session))({
        pgPromise: db,
        schemaName: 'public',
        tableName: 'session'
    }),
    secret: 'neko loli pantsu',
    resave: false,
    saveUninitialized: false,
    cookie: {maxAge: 30 * 24 * 60 * 60 * 1000}
}));

passport.use(new passportLocal.Strategy({
    passReqToCallback: true
}, async function (req, name, pass, done) {
    const [account] = await db.any(sql.getModAccountByName, {name});

    if (!account) {
        return done(null, false, {
            message: i18n.admin[enums.AUTH_ERROR_ACCOUNT_NOT_EXIST]
        });
    }

    if (!account.enabled) {
        return done(null, false, {
            message: i18n.admin[enums.AUTH_ERROR_ACCOUNT_NOT_ENABLED]
        });
    }

    const match = await bcrypt.compare(pass, account.pass);

    if (!match) {
        return done(null, false, {
            message: i18n.admin[enums.AUTH_ERROR_INVALID_PASSWORD]
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

const statsRouter = require('./routes/stats.js');
const adminRouter = require('./routes/admin.js');
const loginRouter = require('./routes/login.js');
const logoutRouter = require('./routes/logout.js');
const mapsRouter = require('./routes/maps.js');

app.use('/', statsRouter);
app.use('/admin', adminRouter);
app.use('/login', loginRouter);
app.use('/logout', logoutRouter);
app.use('/maps', mapsRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
    const status = err.status || 500;
    res.locals.error = req.app.get('env') === 'development' ? err.stack : err.message;
    res.locals.status = status;
    res.locals.title = 'Tw2-Tracker Error';
    res.locals.i18n = i18n;

    res.status(status);
    res.render('error');
});

app.set('port', port);

module.exports = function () {
    const syncSocket = require('./sync-socket.js');
    const httpServer = http.createServer();
    const adminSocketServer = new WebSocket.Server({
        server: httpServer
    });

    httpServer.on('request', app);

    adminSocketServer.on('connection', function connection (adminSocket) {
        syncSocket.on('message', function (data) {
            adminSocket.send(data);
        });

        syncSocket.send(JSON.stringify({
            code: enums.SYNC_REQUEST_STATUS
        }));
    });

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
