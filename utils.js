const {db} = require('./db')
const sql = require('./sql')
const https = require('https')
const crypto = require('crypto')

const noop = function () {}

const schemaExists = async function (schemaName) {
    const schema = await db.one(sql.helpers.schemaExists, {schema: schemaName})
    return schema.exists
}

const worldEntryExists = async function (worldId) {
    const worldEntry = await db.one(sql.worlds.exists, {worldId})
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

const log = function () {
    const args = Array.from(arguments)
    const empty = ' ·'
    const message = []

    switch (args.length) {
        case 0: {
            message.push(empty.repeat(log.level))
            break
        }
        case 1: {
            message.push(empty.repeat(log.level))
            message.push(args[0])
            break
        }
        default: {
            const last = args[args.length - 1]
            const left = args.slice(0, args.length - 1)

            if (typeof last === 'string') {
                switch (last) {
                    case log.INCREASE: {
                        message.push(empty.repeat(log.level))
                        message.push(...left)
                        log.increase()
                        break
                    }
                    case log.DECREASE: {
                        message.push(empty.repeat(log.level))
                        message.push(...left)
                        log.decrease()
                        break
                    }
                    case log.ZERO: {
                        message.push(...left)
                        break
                    }
                    default: {
                        message.push(empty.repeat(log.level))
                        message.push(...args)
                    }
                }
            }
        }
    }

    console.log(...message)
}

log.level = 0
log.INCREASE = 'log_increase'
log.DECREASE = 'log_decrease'
log.ZERO = 'log_zero'

log.increase = function () {
    log.level++
}

log.decrease = function () {
    log.level = Math.max(0, log.level - 1)
}

const timeout = function (handler, time, errorMessage) {
    return new Promise(async function (resolve, reject) {
        const id = setTimeout(function () {
            reject(new Error(errorMessage))
        }, time)

        handler().then(function (result) {
            clearTimeout(id)
            resolve(result)
        }).catch(reject)
    })
}

const hasOwn = Object.prototype.hasOwnProperty

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
    asyncRouter,
    log,
    timeout,
    hasOwn
}
