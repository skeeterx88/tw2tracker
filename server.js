const createError = require('http-errors')
const express = require('express')
const session = require('express-session')
const debug = require('debug')('tw2tracker:server')
const http = require('http')
const path = require('path')
const cookieParser = require('cookie-parser')
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const db = require('./db')
const sql = require('./sql')
const port = isNaN(process.env.PORT) ? 3000 : process.env.PORT
const getSettings = require('./settings')

const indexRouter = require('./routes/index')
const adminRouter = require('./routes/admin')
const loginRouter = require('./routes/login')
const logoutRouter = require('./routes/logout')
const mapsRouter = require('./routes/maps')
const statsRouter = require('./routes/stats')

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

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))

app.use(session({
    store: new (require('connect-pg-simple')(session))({
        pgPromise: db,
        schemaName: 'main',
        tableName: 'session'
    }),
    secret: 'neko loli pantsu',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}))

passport.use(new LocalStrategy(async function (username, password, callback) {
    const settings = getSettings()

    if (!settings || !settings.admin_password) {
        return callback(null, false)
    }

    if (settings.admin_password !== password) {
        return callback(null, false)
    }

    callback(null, username)
}))

passport.serializeUser(function(username, callback) {
    callback(null, username)
})

passport.deserializeUser(function(username, callback) {
    callback(null, username)
})

app.use(passport.initialize())
app.use(passport.session())

if (process.env.NODE_ENV === 'development') {
    app.use(function (req, res, next) {
        setTimeout(next, 1000)
    })
}

app.use('/', indexRouter)
app.use('/admin', adminRouter)
app.use('/login', loginRouter)
app.use('/logout', logoutRouter)
app.use('/maps', mapsRouter)
app.use('/stats', statsRouter)

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404))
})

// error handler
app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    // render the error page
    res.status(err.status || 500)
    res.render('error', {
        title: 'Tw2-Tracker Error'
    })
})

app.set('port', port)

module.exports = function () {
    console.log('Server: Initializing...')

    const server = http.createServer(app)

    server.on('error', function (error) {
        if (error.syscall !== 'listen') {
            throw error
        }

        const bind = typeof port === 'string'
            ? 'Pipe ' + port
            : 'Port ' + port

        switch (error.code) {
            case 'EACCES': {
                console.error(bind + ' requires elevated privileges')
                process.exit(1)
                break
            }
            case 'EADDRINUSE': {
                console.error(bind + ' is already in use')
                process.exit(1)
                break
            }
            default: {
                throw error
            }
        }
    })

    server.on('listening', function () {
        const addr = server.address()
        const bind = typeof addr === 'string'
            ? 'pipe ' + addr
            : 'port ' + addr.port

        debug('Listening on ' + bind)
    })

    server.listen(port)
}
