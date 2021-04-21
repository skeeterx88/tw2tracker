const config = require('./config.js');
const pgp = require('pg-promise')();
/** @type {pgPromise.IBaseProtocol} */
const db = pgp(config('database'));
const path = require('path');
const QueryFile = require('pg-promise').QueryFile;
const sqlCache = new Map();
const sqlBase = path.join(__dirname, 'sql');

/**
 * @param id {String}
 * @return {pgPromise.QueryFile}
 */
function sql (id) {
    if (sqlCache.has(id)) {
        return sqlCache.get(id);
    }

    const parts = id.split('/');
    const name = parts.pop() + '.sql';
    const query = new QueryFile(path.join(sqlBase, ...parts, name));

    if (query.error) {
        throw query.error;
    }

    sqlCache.set(id, query);

    return query;
}

module.exports = {pgp, db, sql};
