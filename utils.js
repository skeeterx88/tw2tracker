const db = require('./db')
const sql = require('./sql')

const noop = function () {}

const schemaExists = async function (schameName) {
    const schema = await db.one(sql.schemaExists, [schameName])
    return schema.exists
}

const worldEntryExists = async function (marketId, worldNumber) {
    const worldEntry = await db.one(sql.worldEntryExists, [marketId, worldNumber])
    return worldEntry.exists
}

const extractNumbers = function (value) {
    const num = value.match(/\d+/)
    return num ? parseInt(num[0], 10) : value
}

module.exports = {
    noop,
    schemaExists,
    worldEntryExists,
    extractNumbers
}
