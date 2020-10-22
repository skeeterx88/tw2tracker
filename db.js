const pgp = require('pg-promise')()
const dbSettings = require('./db.json')

module.exports = pgp(dbSettings)
