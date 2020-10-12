const db = require('./db')
const sql = require('./sql')

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

module.exports = {
    noop,
    schemaExists,
    worldEntryExists,
    extractNumbers,
    makeid,
    getHourlyDir
}
