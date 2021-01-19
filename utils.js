const db = require('./db.js')
const sql = require('./sql.js')
const https = require('https')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

const noop = function () {}

const schemaExists = async function (schemaName) {
    const schema = await db.one(sql.helpers.schemaExists, {schema: schemaName})
    return schema.exists
}

const worldEntryExists = async function (worldId) {
    const worldEntry = await db.one(sql.worldExists, {worldId})
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

const hasOwn = function (obj, property) {
    return Object.prototype.hasOwnProperty.call(obj, property)
}

const capitalize = function (value) {
    return typeof value === 'string'
        ? value.charAt(0).toUpperCase() + value.slice(1)
        : value
}

const ejsHelpers = {
    formatNumbers: function (value) {
        return typeof value === 'number'
            ? value.toLocaleString('pt-BR')
            : value
    },
    formatDate: function (dateObject, timeOffset, flag = false) {
        if (dateObject instanceof Date) {
            if (typeof timeOffset === 'number') {
                dateObject = new Date(dateObject.getTime() + timeOffset)
            } else if (typeof timeOffset === 'string') {
                flag = timeOffset
            }

            const date = [
                dateObject.getFullYear(),
                (dateObject.getMonth() + 1).toString().padStart(2, 0),
                dateObject.getDate().toString().padStart(2, 0)
            ]

            const time = []

            if (flag === 'hours-only') {
                time.push(dateObject.getHours().toString().padStart(2, 0) + 'h')
            } else if (flag === 'day-only') {
                return date.join('/')
            } else {
                time.push(dateObject.getHours().toString().padStart(2, 0))
                time.push(dateObject.getMinutes().toString().padStart(2, 0))
                time.push(dateObject.getSeconds().toString().padStart(2, 0))
            }

            return date.join('/') + ' ' + time.join(':')
        } else {
            throw new Error('formatDate: dateObject is not of type Date')
        }
    },
    capitalize
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
    asyncRouter,
    log,
    timeout,
    hasOwn,
    ejsHelpers,
    capitalize
}
