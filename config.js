const fs = require('fs')
const defaults = require('./share/config.defaults.toml')
const defaultsRaw = fs.readFileSync('./share/config.defaults.toml', 'utf-8')

if (!fs.existsSync('./config.toml')) {
    fs.writeFileSync('./config.toml', defaultsRaw)
}

const userDefined = require('./config.toml')

module.exports = {
    ...defaults,
    ...userDefined
}
