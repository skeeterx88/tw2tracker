const db = require('./db')
const sql = require('./sql')
const settings = db.one(sql.settings.all)

module.exports = async function () {
    return await settings
}
