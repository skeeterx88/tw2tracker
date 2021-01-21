const fs = require('fs')
const ini = require('ini')

if (!fs.existsSync('./db.ini')) {
    const defaults = fs.readFileSync('./share/db.default.ini', 'utf-8')
    fs.writeFileSync('./db.ini', defaults)
}

const pgp = require('pg-promise')()
const config = ini.decode(fs.readFileSync('./db.ini', 'utf-8'))
const db = pgp(config)

module.exports = db
