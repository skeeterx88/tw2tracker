const fs = require('fs')
const ini = require('ini')

if (!fs.existsSync('./config.ini')) {
    const defaults = fs.readFileSync('./config.default.ini', 'utf-8')
    fs.writeFileSync('./config.ini', defaults)
}

module.exports = ini.decode(fs.readFileSync('./config.ini', 'utf-8'))
