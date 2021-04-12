const path = require('path');
const QueryFile = require('pg-promise').QueryFile;
const cache = new Map();
const base = path.join(__dirname, 'sql');

/**
 * @param id {String}
 * @return {pgPromise.QueryFile}
 */
module.exports = function (id) {
    if (cache.has(id)) {
        return cache.get(id);
    }

    const parts = id.split('/');
    const name = parts.pop() + '.sql';
    const query = new QueryFile(path.join(base, ...parts, name));

    if (query.error) {
        throw query.error;
    }

    cache.set(id, query);

    return query;
};
