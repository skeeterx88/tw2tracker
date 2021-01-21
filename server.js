const express = require('express')
const session = require('express-session')
const connectPgSimple = require('connect-pg-simple')
const createError = require('http-errors')
const compression = require('compression')
const debug = require('debug')('tw2tracker:server')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')
const cookieParser = require('cookie-parser')
const passport = require('passport')
const passportLocal = require('passport-local')

const db = require('./db.js')
const config = require('./config.js')

const port = isNaN(process.env.PORT) ? 3000 : process.env.PORT
const app = express()

if (process.env.NODE_ENV === 'production') {
    app.use(function (req, res, next) {
        if (req.headers['x-forwarded-proto'] === 'https') {
            next()
        } else {
            res.redirect('https://' + req.hostname + req.url)
        }
    })
}

app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(compression({level: 9}))
app.use(express.json())
app.use(express.urlencoded({extended: false}))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))
app.use(session({
    store: new (connectPgSimple(session))({
        pgPromise: db,
        schemaName: 'public',
        tableName: 'session'
    }),
    secret: 'neko loli pantsu',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}))

passport.use(new passportLocal.Strategy(async function (username, password, callback) {
    if (!config || !config.admin_password) {
        return callback(null, false)
    }

    if (config.admin_password !== password) {
        return callback(null, false)
    }

    callback(null, username)
}))

passport.serializeUser(function (username, callback) {
    callback(null, username)
})

passport.deserializeUser(function (username, callback) {
    callback(null, username)
})

app.use(passport.initialize())
app.use(passport.session())

const statsRouter = require('./routes/stats.js')
const adminRouter = require('./routes/admin.js')
const loginRouter = require('./routes/login.js')
const logoutRouter = require('./routes/logout.js')
const mapsRouter = require('./routes/maps.js')

app.use('/', statsRouter)
app.use('/admin', adminRouter)
app.use('/login', loginRouter)
app.use('/logout', logoutRouter)
app.use('/maps', mapsRouter)

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404))
})

// error handler
app.use(function (err, req, res, next) {
    const status = err.status || 500
    res.locals.error = req.app.get('env') === 'development' ? err.stack : err.message
    res.locals.status = status
    res.locals.title = 'Tw2-Tracker Error'

    res.status(status)
    res.render('error')
})

app.set('port', port)

module.exports = function () {
    const syncSocket = new WebSocket('ws://127.0.0.1:7777')
    const httpServer = http.createServer()
    const adminSocketServer = new WebSocket.Server({
        server: httpServer
    })

    httpServer.on('request', app)

    adminSocketServer.on('connection', function connection (adminSocket) {
        syncSocket.on('message', function (data) {
            adminSocket.send(data)
        })
    })

    httpServer.on('error', function (error) {
        if (error.syscall !== 'listen') {
            throw error
        }

        const bind = typeof port === 'string'
            ? `Pipe ${port}`
            : `Port ${port}`

        switch (error.code) {
            case 'EACCES': {
                console.error(`${bind} requires elevated privileges`)
                process.exit(1)
                break
            }
            case 'EADDRINUSE': {
                console.error(`${bind} is already in use`)
                process.exit(1)
                break
            }
            default: {
                throw error
            }
        }
    })

    httpServer.on('listening', function () {
        const addr = httpServer.address()
        const bind = typeof addr === 'string'
            ? `pipe ${addr}`
            : `port ${addr.port}`

        debug(`Listening on ${bind}`)
    })

    httpServer.listen(port)
}
