const db = require('./db')
const sql = require('./sql')
const https = require('https')

const noop = function () {}

const schemaExists = async function (schameName) {
    const schema = await db.one(sql.helpers.schemaExists, [schameName])
    return schema.exists
}

const worldEntryExists = async function (marketId, worldNumber) {
    const worldEntry = await db.one(sql.worlds.exists, [marketId, worldNumber])
    return worldEntry.exists
}

const extractNumbers = function (value) {
    const num = value.match(/\d+/)
    return num ? parseInt(num[0], 10) : value
}

const makeid = function (length) {
    let result = ''
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    return result
}

const getHourlyDir = function (now) {
    const rawNow = (now || new Date()).toISOString()
    const [date, rawTime] = rawNow.split('T')
    const [hour] = rawTime.split(':')
    return date + '-' + hour
}

const getHTML = function (url) {
    return new Promise(function (resolve) {
        const HTMLParser = require('fast-html-parser')

        https.get(url, function (res) {
            res.setEncoding('utf8')

            let body = ''

            res.on('data', data => { body += data })
            res.on('end', async function () {
                resolve(HTMLParser.parse(body))
            })
        })
    })
}

const getBuffer = function (url) {
    return new Promise(function (resolve) {
        https.get(url, function (res) {
            let data = []

            res.on('data', function (chunk) {
                data.push(chunk)
            })

            res.on('end', async function () {
                resolve(Buffer.concat(data))
            })
        })
    })
}

module.exports = {
    noop,
    schemaExists,
    worldEntryExists,
    extractNumbers,
    makeid,
    getHourlyDir,
    getHTML,
    getBuffer
}
