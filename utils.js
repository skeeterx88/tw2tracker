const db = require('./db')
const sql = require('./sql')
const https = require('https')
const crypto = require('crypto')

const noop = function () {}

const schemaExists = async function (schemaName) {
    const schema = await db.one(sql.helpers.schemaExists, [schemaName])
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
    return `${date}-${hour}`
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

const perf = function (type = perf.SECONDS) {
    const start = Date.now()

    return {
        end: function () {
            const end = Date.now()

            switch (type) {
                case perf.MILLISECONDS: {
                    return (Math.round(((end - start)) * 10) / 10) + 'ms'
                }
                case perf.SECONDS: {
                    return (Math.round(((end - start) / 1000) * 10) / 10) + 's'
                }
                case perf.MINUTES: {
                    return (Math.round(((end - start) / 1000 / 60) * 10) / 10) + 'm'
                }
            }
        }
    }
}

perf.MILLISECONDS = 'milliseconds'
perf.SECONDS = 'seconds'
perf.MINUTES = 'minutes'

const sha1sum = function (value) {
    const hash = crypto.createHash('sha1')
    hash.update(value)
    return hash.digest('hex')
}

const asyncRouter = function (handler) {
    return function (req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next)
    }
}

module.exports = {
    noop,
    schemaExists,
    worldEntryExists,
    extractNumbers,
    makeid,
    getHourlyDir,
    getHTML,
    getBuffer,
    perf,
    sha1sum,
    asyncRouter
}
