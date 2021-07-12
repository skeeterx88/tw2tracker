// TW2-Tracker
// Copyright (C) 2021 Relaxeaza
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
