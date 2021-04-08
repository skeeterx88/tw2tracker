(async function () {
    const cluster = require('cluster');
    const server = require('./server.js');

    if (!cluster.isMaster) {
        return server();
    }

    const {db} = require('./db.js');

    try {
        (await db.connect()).done();
    } catch (error) {
        throw new Error(`Can't connect to PostgreSQL database: ${error.message}`);
    }

    const sql = require('./sql.js');
    const table = await db.one(sql('helpers/table-exists'), 'markets');

    if (!table.exists) {
        await db.query(sql('create-schema'));
    }

    const Sync = require('./sync.js');
    const cpus = require('os').cpus();

    for (let i = 0; i < cpus.length; i++) {
        const worker = cluster.fork();
        worker.on('message', Sync.trigger);
    }

    Sync.init();
})();
