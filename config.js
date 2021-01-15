const fs = require('fs')
const ini = require('ini')

module.exports = ini.decode(fs.readFileSync('./config.ini', 'utf-8'))
