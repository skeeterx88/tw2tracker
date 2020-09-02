const settings = require('./settings')
const pgp = require('pg-promise')()
const db = pgp({
    user: settings.db_user,
    host: settings.db_host,
    database: settings.db_name,
    password: settings.db_password,
    port: settings.db_port
})

module.exports = db
