const pgp = require('pg-promise')()
const dbSettings = require('./db.json')
const db = pgp(dbSettings)

module.exports = {pgp, db}
