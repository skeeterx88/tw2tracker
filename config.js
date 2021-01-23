const fs = require('fs')
const ini = require('ini')

const defaultsRaw = fs.readFileSync('./share/config.default.ini', 'utf-8')
const defaults = ini.decode(defaultsRaw)

if (!fs.existsSync('./config.ini')) {
    fs.writeFileSync('./config.ini', defaultsRaw)
}

const user = ini.decode(fs.readFileSync('./config.ini', 'utf-8'))

module.exports = {
    ...defaults,
    ...user
}
