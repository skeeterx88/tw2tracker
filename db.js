const fs = require('fs')
const ini = require('ini')

if (!fs.existsSync('./db.ini')) {
    const defaults = fs.readFileSync('./share/db.default.ini', 'utf-8')
    fs.writeFileSync('./db.ini', defaults)
}

const pgp = require('pg-promise')()
const dbconfig = ini.decode(fs.readFileSync('./db.ini', 'utf-8'))

module.exports = pgp(dbconfig)
