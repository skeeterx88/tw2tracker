const path = require('path');
const QueryFile = require('pg-promise').QueryFile;
const cache = new Map();
const base = path.join(__dirname, 'sql');

module.exports = function (id) {
    if (typeof id !== 'string') {
        throw TypeError('SQL: Argument "id" is not a String');
    }
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
