const createError = require('http-errors')
const express = require('express')
const session = require('express-session')
const path = require('path')
const cookieParser = require('cookie-parser')
const logger = require('morgan')
const passport = require('passport')
const LocalStrategy = require('passport-local').Strategy
const db = require('./db')
const sql = require('./sql')
const Sync = require('./sync')

// console.log(sql)

const indexRouter = require('./routes/index')
const adminRouter = require('./routes/admin')
const loginRouter = require('./routes/login')
const logoutRouter = require('./routes/logout')
const mapsRouter = require('./routes/maps')

const app = express()

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))
app.use(session({
    secret: 'neko loli pantsu',
    resave: false,
    saveUninitialized: false
}))

passport.use(new LocalStrategy(async function (username, password, callback) {
    const settings = await db.one(sql.settings, [])

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

app.use('/', indexRouter)
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
    // set locals, only providing error in development
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    // render the error page
    res.status(err.status || 500)
    res.render('error')
})

Sync.init()

module.exports = app
