const fs = require('fs')
const ini = require('ini')
const pgp = require('pg-promise')()
const dbconfig = ini.decode(fs.readFileSync('./db.ini', 'utf-8'))
const db = pgp(dbconfig)

module.exports = {pgp, db}
