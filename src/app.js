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

(async function () {
    const cluster = require('cluster');

    const {db, sql} = require('./db.js');

    try {
        (await db.connect()).done();
    } catch (error) {
        throw new Error(`Can't connect to PostgreSQL database: ${error.message}`);
    }

    const table = await db.one(sql('helpers/table-exists'), 'markets');

    if (!table.exists) {
        await db.query(sql('create-schema'));
    }

    const server = require('./server.js');

    if (!cluster.isMaster) {
        return server();
    }

    const Sync = require('./sync.js');
    const cpus = require('os').cpus();

    for (let i = 0; i < cpus.length; i++) {
        const worker = cluster.fork();
        worker.on('message', Sync.trigger);
    }

    await Sync.init();
})();
